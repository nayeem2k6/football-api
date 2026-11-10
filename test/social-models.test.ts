import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { CommentModel } from "../src/database/models/comment.model";
import { CommentReportModel } from "../src/database/models/comment-report.model";
import { LikeModel } from "../src/database/models/like.model";

describe("social model validation", () => {
  it("requires a user and a supported content target for likes", () => {
    const valid = new LikeModel({
      userId: new Types.ObjectId(),
      targetType: "video",
      targetId: new Types.ObjectId(),
    });
    assert.equal(valid.validateSync(), undefined);

    const invalid = new LikeModel({
      userId: new Types.ObjectId(),
      targetType: "user",
      targetId: new Types.ObjectId(),
    });
    assert.equal(invalid.validateSync()?.errors.targetType?.name, "ValidatorError");
  });

  it("requires non-empty comments within the documented length limit", () => {
    const base = {
      targetType: "article",
      targetId: new Types.ObjectId(),
      authorId: new Types.ObjectId(),
    };
    assert.equal(
      new CommentModel({ ...base, body: "A useful comment." }).validateSync(),
      undefined,
    );
    assert.equal(
      new CommentModel({ ...base, body: "   " }).validateSync()?.errors.body?.name,
      "ValidatorError",
    );
    assert.equal(
      new CommentModel({ ...base, body: "a".repeat(1001) }).validateSync()?.errors.body?.name,
      "ValidatorError",
    );
  });

  it("enforces idempotent likes and supports newest-first comment pagination", () => {
    const likeIndexes = LikeModel.schema.indexes();
    const commentIndexes = CommentModel.schema.indexes();
    assert(
      likeIndexes.some(
        ([fields, options]) =>
          fields.userId === 1 &&
          fields.targetType === 1 &&
          fields.targetId === 1 &&
          options?.unique === true,
      ),
    );
    assert(
      commentIndexes.some(
        ([fields]) =>
          fields.targetType === 1 &&
          fields.targetId === 1 &&
          fields.deletedAt === 1 &&
          fields.createdAt === -1,
      ),
    );
  });

  it("validates report categories and prevents duplicate reports per user/comment", () => {
    const report = new CommentReportModel({
      commentId: new Types.ObjectId(),
      reporterId: new Types.ObjectId(),
      reason: "spam",
    });
    assert.equal(report.validateSync(), undefined);
    assert.equal(
      new CommentReportModel({
        commentId: new Types.ObjectId(),
        reporterId: new Types.ObjectId(),
        reason: "invalid",
      }).validateSync()?.errors.reason?.name,
      "ValidatorError",
    );
    assert(
      CommentReportModel.schema.indexes().some(
        ([fields, options]) =>
          fields.reporterId === 1 &&
          fields.commentId === 1 &&
          options?.unique === true,
      ),
    );
  });
});
