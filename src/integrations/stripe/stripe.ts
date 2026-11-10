import Stripe from "stripe";
import { env, isStripeConfigured } from "../../config/env";
import { ServiceUnavailableError } from "../../shared/http-error";

let stripe: Stripe | undefined;

export function getStripeClient(): Stripe {
  if (!isStripeConfigured || !env.STRIPE_SECRET_KEY) {
    throw new ServiceUnavailableError(
      "Stripe Connect is not configured on the API.",
    );
  }
  stripe ??= new Stripe(env.STRIPE_SECRET_KEY);
  return stripe;
}
