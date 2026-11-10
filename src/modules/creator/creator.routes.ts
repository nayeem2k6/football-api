import { Router } from "express";
import { UserModel } from "../../database/models/user.model";
import { getStripeClient } from "../../integrations/stripe/stripe";
import { env } from "../../config/env";
import { requireAuth } from "../auth/auth.middleware";
import { HttpError } from "../../shared/http-error";

export const creatorRouter = Router();

async function getAccountRecord(userId: string) {
  const user = await UserModel.findById(userId)
    .select("+stripeConnectAccountId")
    .lean();
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Your user profile was not found.");
  }
  return user;
}

function getOnboardingUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com") {
    throw new HttpError(
      502,
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "Stripe returned an invalid onboarding link.",
    );
  }
  return url.toString();
}

function logStripeError(operation: string, error: unknown): void {
  const details =
    typeof error === "object" && error !== null && "type" in error
      ? { type: error.type }
      : { type: "unknown" };
  console.error(`Stripe Connect ${operation} failed`, details);
}

creatorRouter.get(
  "/monetization",
  requireAuth,
  async (request, response, next) => {
    try {
      const currentUser = request.user;
      if (!currentUser) {
        throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      const user = await getAccountRecord(currentUser.id);
      if (!user.stripeConnectAccountId) {
        response.status(200).json({
          onboardingStatus: "not_started",
          earningsEnabled: false,
          payoutsEnabled: false,
        });
        return;
      }

      const stripe = getStripeClient();
      let account: Awaited<ReturnType<typeof stripe.accounts.retrieve>>;
      try {
        account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
      } catch (error) {
        logStripeError("account status retrieval", error);
        throw new HttpError(
          502,
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Stripe account status could not be retrieved.",
        );
      }

      if ("deleted" in account && account.deleted) {
        throw new HttpError(
          409,
          "CONNECT_ACCOUNT_CLOSED",
          "The connected Stripe account is closed. Contact platform support.",
        );
      }
      response.status(200).json({
        onboardingStatus: account.details_submitted ? "complete" : "in_progress",
        earningsEnabled: false,
        payoutsEnabled: false,
      });
    } catch (error) {
      next(error);
    }
  },
);

creatorRouter.post(
  "/monetization/connect",
  requireAuth,
  async (request, response, next) => {
    try {
      const currentUser = request.user;
      if (!currentUser) {
        throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      const user = await getAccountRecord(currentUser.id);
      const stripe = getStripeClient();
      let accountId = user.stripeConnectAccountId;

      if (!accountId) {
        let account: Awaited<ReturnType<typeof stripe.accounts.create>>;
        try {
          account = await stripe.accounts.create(
            {
              type: "express",
              country: "US",
              ...(user.email ? { email: user.email } : {}),
              capabilities: { transfers: { requested: true } },
            },
            { idempotencyKey: `football-platform:connect:${user._id.toString()}` },
          );
        } catch (error) {
          logStripeError("account creation", error);
          throw new HttpError(
            502,
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Stripe could not start account onboarding.",
          );
        }
        accountId = account.id;
        const updated = await UserModel.findByIdAndUpdate(
          user._id,
          { $set: { stripeConnectAccountId: accountId } },
          { new: true },
        )
          .select("+stripeConnectAccountId")
          .lean();
        if (!updated) {
          throw new HttpError(
            500,
            "CONNECT_ACCOUNT_SAVE_FAILED",
            "The Stripe account could not be attached to your profile.",
          );
        }
        if (!updated.stripeConnectAccountId) {
          throw new HttpError(
            500,
            "CONNECT_ACCOUNT_SAVE_FAILED",
            "The Stripe account could not be attached to your profile.",
          );
        }
        accountId = updated.stripeConnectAccountId;
      }

      let account: Awaited<ReturnType<typeof stripe.accounts.retrieve>>;
      try {
        account = await stripe.accounts.retrieve(accountId);
      } catch (error) {
        logStripeError("account retrieval", error);
        throw new HttpError(
          502,
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Stripe account status could not be retrieved.",
        );
      }
      if ("deleted" in account && account.deleted) {
        throw new HttpError(
          409,
          "CONNECT_ACCOUNT_CLOSED",
          "The connected Stripe account is closed. Contact platform support.",
        );
      }
      if (account.details_submitted) {
        response.status(200).json({
          onboardingUrl: null,
          onboardingStatus: "complete",
          earningsEnabled: false,
          payoutsEnabled: false,
        });
        return;
      }

      let accountLink: Awaited<ReturnType<typeof stripe.accountLinks.create>>;
      try {
        accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: new URL(
            "/creator/monetization?refresh=1",
            env.WEB_ORIGIN,
          ).toString(),
          return_url: new URL(
            "/creator/monetization?return=1",
            env.WEB_ORIGIN,
          ).toString(),
          type: "account_onboarding",
        });
      } catch (error) {
        logStripeError("onboarding link creation", error);
        throw new HttpError(
          502,
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Stripe could not create an onboarding link.",
        );
      }

      response.status(200).json({
        onboardingUrl: getOnboardingUrl(accountLink.url),
        onboardingStatus: "in_progress",
        earningsEnabled: false,
        payoutsEnabled: false,
      });
    } catch (error) {
      next(error);
    }
  },
);
