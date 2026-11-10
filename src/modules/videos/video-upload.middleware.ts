import { open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { extname } from "node:path";
import multer from "multer";
import { HttpError } from "../../shared/http-error";
import { maxVideoBytes } from "./video-upload.constants";

const allowedMimeTypes: Record<string, ReadonlySet<string>> = {
  ".mp4": new Set(["video/mp4"]),
  ".mov": new Set(["video/quicktime"]),
  ".webm": new Set(["video/webm"]),
  ".m4v": new Set(["video/x-m4v", "video/mp4"]),
};

export const videoUpload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (_request, _file, callback) => callback(null, randomUUID()),
  }),
  limits: {
    fileSize: maxVideoBytes,
    files: 1,
    fields: 3,
    fieldSize: 64 * 1024,
    parts: 4,
  },
  fileFilter: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    const allowedMimeTypesForExtension = allowedMimeTypes[extension];
    if (!allowedMimeTypesForExtension) {
      callback(new HttpError(415, "UNSUPPORTED_VIDEO_FORMAT", "Use an MP4, MOV, WebM, or M4V video."));
      return;
    }
    if (!allowedMimeTypesForExtension.has(file.mimetype.toLowerCase())) {
      callback(new HttpError(415, "VIDEO_MIME_MISMATCH", "The video MIME type does not match its file extension."));
      return;
    }
    callback(null, true);
  },
});

export async function validateVideoFileSignature(
  filePath: string,
  originalName: string,
): Promise<void> {
  const extension = extname(originalName).toLowerCase();
  const handle = await open(filePath, "r");
  const header = Buffer.alloc(64);

  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (extension === ".webm") {
      if (
        bytesRead < 4 ||
        !header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      ) {
        throw new HttpError(415, "INVALID_VIDEO_CONTENT", "The file content is not a valid WebM video.");
      }
      return;
    }

    if (bytesRead < 12 || header.toString("ascii", 4, 8) !== "ftyp") {
      throw new HttpError(415, "INVALID_VIDEO_CONTENT", "The file content is not a valid MP4, MOV, or M4V video.");
    }

    const boxSize = header.readUInt32BE(0);
    if (boxSize < 16) {
      throw new HttpError(415, "INVALID_VIDEO_CONTENT", "The video file header is invalid.");
    }

    const brands: string[] = [];
    const availableHeaderBytes = Math.min(boxSize, bytesRead);
    for (let offset = 8; offset + 4 <= availableHeaderBytes; offset += 4) {
      brands.push(header.toString("ascii", offset, offset + 4));
    }

    const isQuickTime = brands.includes("qt  ");
    const isM4v = brands.some((brand) => brand.startsWith("M4V"));
    const isMp4 = brands.some((brand) =>
      /^(isom|iso[2-9]|mp4[12]|avc1|dash)$/.test(brand),
    );
    const matchesExtension =
      extension === ".mov"
        ? isQuickTime
        : extension === ".m4v"
          ? isM4v || isMp4
          : extension === ".mp4"
            ? isMp4 || isM4v
            : false;

    if (!matchesExtension) {
      throw new HttpError(415, "INVALID_VIDEO_CONTENT", "The video content does not match its file extension.");
    }
  } finally {
    await handle.close();
  }
}
