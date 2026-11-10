import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import express from "express";
import { after, before, describe, it } from "node:test";
import { errorHandler } from "../src/middleware/error-handler";
import { maxVideoBytes } from "../src/modules/videos/video-upload.constants";
import {
  validateVideoFileSignature,
  videoUpload,
} from "../src/modules/videos/video-upload.middleware";

const app = express();
app.post("/upload", videoUpload.single("file"), async (request, response) => {
  if (request.file) await unlink(request.file.path);
  response.sendStatus(204);
});
app.use(errorHandler);

const server = createServer(app);
let port: number;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  port = address.port;
});

after(async () => {
  server.close();
  await once(server, "close");
});

function upload(filename: string, mimeType: string, size: number): Promise<number> {
  const boundary = "video-upload-test-boundary";
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const content = Readable.from(
    (async function* () {
      yield header;
      const chunk = Buffer.alloc(1024 * 1024);
      let remaining = size;
      while (remaining > 0) {
        const chunkSize = Math.min(remaining, chunk.length);
        yield chunkSize === chunk.length ? chunk : chunk.subarray(0, chunkSize);
        remaining -= chunkSize;
      }
      yield footer;
    })(),
  );

  return new Promise((resolve, reject) => {
    const requestBody = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/upload",
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": header.length + size + footer.length,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    requestBody.on("error", reject);
    content.pipe(requestBody);
  });
}

describe("video upload request validation", () => {
  it("allows exactly 100,000,000 bytes and rejects the next byte", async () => {
    assert.equal(maxVideoBytes, 100_000_000);
    assert.equal(await upload("clip.mp4", "video/mp4", maxVideoBytes), 204);
    assert.equal(await upload("clip.mp4", "video/mp4", maxVideoBytes + 1), 413);
  });

  it("rejects unsupported extensions and mismatched MIME types", async () => {
    assert.equal(await upload("clip.exe", "video/mp4", 8), 415);
    assert.equal(await upload("clip.mp4", "video/webm", 8), 415);
  });
});

describe("video container signature validation", () => {
  it("accepts supported containers whose contents match their extensions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "video-signature-test-"));
    try {
      const mp4 = Buffer.alloc(20);
      mp4.writeUInt32BE(20, 0);
      mp4.write("ftyp", 4);
      mp4.write("isom", 8);
      mp4.writeUInt32BE(0, 12);
      mp4.write("mp42", 16);
      const mov = Buffer.alloc(16);
      mov.writeUInt32BE(16, 0);
      mov.write("ftyp", 4);
      mov.write("qt  ", 8);
      mov.writeUInt32BE(0, 12);
      const m4v = Buffer.alloc(16);
      m4v.writeUInt32BE(16, 0);
      m4v.write("ftyp", 4);
      m4v.write("M4V ", 8);
      m4v.writeUInt32BE(0, 12);
      const extendedMp4 = Buffer.alloc(128);
      extendedMp4.writeUInt32BE(128, 0);
      extendedMp4.write("ftyp", 4);
      extendedMp4.write("isom", 8);
      extendedMp4.writeUInt32BE(0, 12);
      extendedMp4.write("mp42", 16);
      const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88]);

      for (const [filename, content] of [
        ["clip.mp4", mp4],
        ["clip.mov", mov],
        ["clip.m4v", m4v],
        ["extended.mp4", extendedMp4],
        ["clip.webm", webm],
      ] as const) {
        const path = join(directory, filename);
        await writeFile(path, content);
        await validateVideoFileSignature(path, filename);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects fake content and a real container with the wrong extension", async () => {
    const directory = await mkdtemp(join(tmpdir(), "video-signature-test-"));
    try {
      const fakePath = join(directory, "fake.mp4");
      await writeFile(fakePath, "not a video");
      await assert.rejects(
        validateVideoFileSignature(fakePath, "fake.mp4"),
        { code: "INVALID_VIDEO_CONTENT" },
      );

      const mp4 = Buffer.alloc(20);
      mp4.writeUInt32BE(20, 0);
      mp4.write("ftyp", 4);
      mp4.write("isom", 8);
      mp4.writeUInt32BE(0, 12);
      mp4.write("mp42", 16);
      const mismatchPath = join(directory, "mismatch.mov");
      await writeFile(mismatchPath, mp4);
      await assert.rejects(
        validateVideoFileSignature(mismatchPath, "mismatch.mov"),
        { code: "INVALID_VIDEO_CONTENT" },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
