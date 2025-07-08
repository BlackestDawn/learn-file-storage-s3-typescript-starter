import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = await req.formData();
  const file = formData.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("Invalid file");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large");
  }

  const mediaType = file.type;
  const data = await file.arrayBuffer();
  const fileName = videoId + path.extname(file.name);
  const filePath = path.join(cfg.assetsRoot, fileName);

  await Bun.write(filePath, new Uint8Array(data));

  const videoData = getVideo(cfg.db, videoId);
  if (videoData?.userID !== userID) {
    throw new UserForbiddenError("Not authorized to upload thumbnail");
  }

  const thumbnailURL = `http://localhost:${cfg.port}/assets/${fileName}`

  videoData.thumbnailURL = thumbnailURL;

  updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}
