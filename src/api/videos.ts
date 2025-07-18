import { respondWithJSON } from "./json";
import { BadRequestError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
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
  let fileName = randomBytes(32).toString("hex") + path.extname(file.name);
  let filePath = join(tmpdir(), fileName);

  await Bun.write(filePath, new Uint8Array(data));

  const aspectRatio = await getVideoAspectRatio(filePath);
  filePath = await processVideoForFastStart(filePath);
  const s3Key = aspectRatio + "/" + fileName;
  const s3file = cfg.s3Client.file(s3Key);
  await s3file.write(Bun.file(filePath));

  await Bun.file(filePath).delete();

  videoData.videoURL = `https://${cfg.cdnDomain}/${aspectRatio}/${fileName}`;
  updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}

async function getVideoAspectRatio(filePath: string) {
  const videoData = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], {
    stdout: "pipe",
  });
  const aspectRatioText = await new Response(videoData.stdout).text();
  const aspectRatio = Math.round((JSON.parse(aspectRatioText).streams[0].width / JSON.parse(aspectRatioText).streams[0].height) * 100) / 100;
  switch (aspectRatio) {
    case Math.round(16 / 9 * 100) / 100:
      return "landscape";
    case Math.round(9 / 16 * 100) / 100:
      return "portrait";
    default:
      return "other";
  }
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath.replace(".mp4", "-fast.mp4");
  const ffmpeg = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "+faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await ffmpeg.exited;

  await Bun.file(inputFilePath).delete();
  return outputFilePath;
}
