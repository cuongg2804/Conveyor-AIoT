import { Request, Response } from "express";
import minioClient from "../config/minio";

const normalizeObjectKey = (value: unknown) =>
  String(value || "")
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/")
    .replace(/^\/+/, "");

export const streamMinioObject = async (req: Request, res: Response) => {
  try {
    const params = req.params as Record<string, any>;
    const bucket = decodeURIComponent(String(params[0] || params.bucket || ""));
    const objectKey = normalizeObjectKey(params[1] || params.objectKey);

    if (!bucket || !objectKey) {
      return res.status(400).send("Missing MinIO bucket or object key.");
    }

    const stat = await minioClient.statObject(bucket, objectKey);
    const objectStream = await minioClient.getObject(bucket, objectKey);

    res.setHeader("Content-Type", stat.metaData?.["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=300");

    objectStream.on("error", (error) => {
      console.error("MinIO object stream error:", error);
      if (!res.headersSent) res.status(500).end();
    });

    objectStream.pipe(res);
  } catch (error: any) {
    console.error("streamMinioObject error:", error);
    return res.status(404).send("Image not found.");
  }
};
