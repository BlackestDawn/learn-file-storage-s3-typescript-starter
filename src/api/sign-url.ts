import { cfg, type ApiConfig } from "../config";
import { type Video } from "../db/videos";
import { BadRequestError } from "./errors";

export async function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number) {
  const presignUrl = cfg.s3Client.presign(key, { expiresIn: expireTime });
  return presignUrl;
}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) return video;
  video.videoURL = await generatePresignedURL(cfg, video.videoURL, 3600);
  return video;
}
