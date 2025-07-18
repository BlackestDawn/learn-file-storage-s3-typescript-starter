import { respondWithJSON } from "./json";
import { BadRequestError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { join } from "path";
import path from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const maxFilesize = 1 << 30; // 1 GB
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) throw new BadRequestError("Invalid video ID");

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoData = getVideo(cfg.db, videoId);
  if (videoData?.userID !== userID) throw new UserForbiddenError("Not authorized to upload video");

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) throw new BadRequestError("Invalid file");
  if (file.size > maxFilesize) throw new BadRequestError("File too large");

  const mediaType = file.type;
  if (mediaType !== "video/mp4" && mediaType !== "video/webm") throw new BadRequestError("Invalid media type");
  const data = await file.arrayBuffer();
  const fileName = randomBytes(32).toString("hex") + path.extname(file.name);
  const filePath = join(tmpdir(), fileName);

  await Bun.write(filePath, new Uint8Array(data));

  const s3file = cfg.s3Client.file(fileName);
  await s3file.write(Bun.file(filePath));
  await Bun.file(filePath).delete();

  videoData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}`;
  updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}
