import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { env, isCloudinaryConfigured } from "../../config/env";
import { HttpError, ServiceUnavailableError } from "../../shared/http-error";
import {
  maxVideoBytes,
  maxVideoDurationSeconds,
} from "../../modules/videos/video-upload.constants";

const allowedFormats = new Set(["mp4", "mov", "webm", "m4v"]);

interface CloudinaryVideoAsset {
  public_id: string;
  resource_type: string;
  format: string;
  bytes: number;
  duration: number;
  secure_url: string;
}

function getCloudinaryConfig() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    env;
  if (
    !isCloudinaryConfigured ||
    !CLOUDINARY_CLOUD_NAME ||
    !CLOUDINARY_API_KEY ||
    !CLOUDINARY_API_SECRET
  ) {
    throw new ServiceUnavailableError("Video publishing is not configured.");
  }
  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
  };
}

export async function uploadVideoFile(filePath: string): Promise<CloudinaryVideoAsset> {
  const config = getCloudinaryConfig();
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
  });

  let response;
  try {
    response = await cloudinary.uploader.upload(
      filePath,
      {
        allowed_formats: ["mp4", "mov", "webm", "m4v"],
        folder: "football-platform",
        public_id: randomUUID(),
        resource_type: "video",
        tags: ["football-platform"],
      },
    );
  } catch (error) {
    console.error("Cloudinary video upload failed", error);
    throw new ServiceUnavailableError("The video provider could not complete this upload.");
  }

  if (!("duration" in response) || typeof response.duration !== "number") {
    throw new ServiceUnavailableError(
      "The video provider did not return valid video metadata.",
    );
  }
  const uploaded: CloudinaryVideoAsset = {
    public_id: response.public_id,
    resource_type: response.resource_type,
    format: response.format,
    bytes: response.bytes,
    duration: response.duration,
    secure_url: response.secure_url,
  };
  const playbackUrl = new URL(uploaded.secure_url);
  if (
    uploaded.resource_type !== "video" ||
    !allowedFormats.has(uploaded.format.toLowerCase()) ||
    uploaded.bytes < 1 ||
    uploaded.bytes > maxVideoBytes ||
    uploaded.duration <= 0 ||
    uploaded.duration > maxVideoDurationSeconds ||
    playbackUrl.protocol !== "https:" ||
    playbackUrl.hostname !== "res.cloudinary.com"
  ) {
    try {
      await cloudinary.uploader.destroy(uploaded.public_id, {
        resource_type: "video",
        invalidate: true,
      });
    } catch (error) {
      console.error("Could not remove a rejected Cloudinary video", error);
    }
    throw new HttpError(400, "INVALID_VIDEO_ASSET", "Videos must be MP4, MOV, WebM, or M4V, no larger than 100 MB or 10 minutes.");
  }
  return uploaded;
}
