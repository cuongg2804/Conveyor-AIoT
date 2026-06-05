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
      return res.status(400).send("Thiếu bucket hoặc object key trong MinIO.");
    }

    const stat = await minioClient.statObject(bucket, objectKey);
    const objectStream = await minioClient.getObject(bucket, objectKey);

    res.setHeader("Content-Type", stat.metaData?.["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=300");

    objectStream.on("error", (error) => {
      console.error("Lỗi stream đối tượng MinIO:", error);
      if (!res.headersSent) res.status(500).end();
    });

    objectStream.pipe(res);
  } catch (error: any) {
    console.error("Lỗi stream đối tượng MinIO:", error);
    return res.status(404).send("Không tìm thấy tệp.");
  }
};
