import type { Request } from "express";
import { Types } from "mongoose";
import { AdminAuditLogModel } from "../database/models/admin-audit-log.model";
import type { AdminAuditAction } from "../database/models/admin-audit-log.model";
import { HttpError } from "./http-error";

export function requireAdmin(request: Request) {
  if (!request.user || request.user.role !== "admin") {
    throw new HttpError(403, "ADMIN_REQUIRED", "An administrator account is required.");
  }
  return request.user;
}

export async function writeAdminAudit(input: {
  actorId: string;
  action: AdminAuditAction;
  targetType: "user" | "comment" | "comment-report" | "video" | "video-report" | "article";
  targetId: Types.ObjectId;
  details: Record<string, string | boolean | null>;
}): Promise<void> {
  await AdminAuditLogModel.create({
    ...input,
    actorId: new Types.ObjectId(input.actorId),
  });
}
