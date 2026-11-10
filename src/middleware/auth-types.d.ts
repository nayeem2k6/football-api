import type { UserRecord } from "../database/models/user.model";

declare global {
  namespace Express {
    interface Request {
      user?: UserRecord & { id: string };
    }
  }
}

export {};
