import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware";
import { FollowModel } from "../../database/models/follow.model";
import { UserModel } from "../../database/models/user.model";
import { HttpError } from "../../shared/http-error";

export const meRouter = Router();

const profileSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9_]+$/, "Use only letters, numbers, and underscores."),
    displayName: z.string().trim().min(1).max(100),
    bio: z.string().trim().max(280),
  })
  .strict();

function requireCurrentUser(request: Parameters<typeof requireAuth>[0]) {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
  }
  return request.user;
}

meRouter.get("/me", requireAuth, (request, response) => {
  const user = requireCurrentUser(request);
  response.status(200).json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
      bio: user.bio,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    },
  });
});

meRouter.patch("/me", requireAuth, async (request, response, next) => {
  try {
    const user = requireCurrentUser(request);
    const profile = profileSchema.parse(request.body);
    const updatedUser = await UserModel.findByIdAndUpdate(
      user.id,
      { $set: profile },
      { new: true, runValidators: true },
    ).lean();

    if (!updatedUser) {
      throw new HttpError(404, "USER_NOT_FOUND", "Your profile was not found.");
    }

    response.status(200).json({
      user: {
        id: updatedUser._id.toString(),
        username: updatedUser.username,
        email: updatedUser.email,
        emailVerified: updatedUser.emailVerified,
        displayName: updatedUser.displayName,
        photoUrl: updatedUser.photoUrl,
        bio: updatedUser.bio,
        role: updatedUser.role,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

meRouter.get("/users/:username", async (request, response, next) => {
  try {
    const { username } = z
      .object({ username: profileSchema.shape.username })
      .parse(request.params);
    const user = await UserModel.findOne({ username })
      .select("username displayName photoUrl bio createdAt")
      .lean();

    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "This profile was not found.");
    }

    const [followerCount, followingCount] = await Promise.all([
      FollowModel.countDocuments({ followeeId: user._id }),
      FollowModel.countDocuments({ followerId: user._id }),
    ]);

    response.status(200).json({
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
        bio: user.bio,
        createdAt: user.createdAt,
      },
      counts: { followers: followerCount, following: followingCount },
    });
  } catch (error) {
    next(error);
  }
});

meRouter.put(
  "/users/:userId/follow",
  requireAuth,
  async (request, response, next) => {
    try {
      const currentUser = requireCurrentUser(request);
      const { userId } = z
        .object({ userId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);

      if (currentUser.id === userId) {
        throw new HttpError(400, "CANNOT_FOLLOW_SELF", "You cannot follow yourself.");
      }

      const target = await UserModel.findById(userId).select("_id").lean();
      if (!target) {
        throw new HttpError(404, "USER_NOT_FOUND", "This profile was not found.");
      }

      try {
        await FollowModel.create({
          followerId: new Types.ObjectId(currentUser.id),
          followeeId: target._id,
        });
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== 11000
        ) {
          throw error;
        }
      }

      response.status(200).json({ following: true });
    } catch (error) {
      next(error);
    }
  },
);

meRouter.get(
  "/users/:userId/follow",
  requireAuth,
  async (request, response, next) => {
    try {
      const currentUser = requireCurrentUser(request);
      const { userId } = z
        .object({ userId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      if (currentUser.id === userId) {
        response.status(200).json({ following: false, isSelf: true });
        return;
      }
      const following = await FollowModel.exists({
        followerId: new Types.ObjectId(currentUser.id),
        followeeId: new Types.ObjectId(userId),
      });
      response.status(200).json({ following: Boolean(following), isSelf: false });
    } catch (error) {
      next(error);
    }
  },
);

meRouter.delete(
  "/users/:userId/follow",
  requireAuth,
  async (request, response, next) => {
    try {
      const currentUser = requireCurrentUser(request);
      const { userId } = z
        .object({ userId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      await FollowModel.deleteOne({
        followerId: new Types.ObjectId(currentUser.id),
        followeeId: new Types.ObjectId(userId),
      });
      response.status(200).json({ following: false });
    } catch (error) {
      next(error);
    }
  },
);
