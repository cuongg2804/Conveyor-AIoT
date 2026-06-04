import * as Minio from "minio";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath, override: false });
}

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});

export const MINIO_BUCKET =
  process.env.MINIO_MODEL_BUCKET || process.env.MINIO_BUCKET || "ai-models";

  console.log("[MINIO_CONFIG]", {
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "admin",
  modelBucket: process.env.MINIO_MODEL_BUCKET || "ai-models",
  imageBucket: process.env.MINIO_IMAGE_BUCKET || "inspection-images",
});

export default minioClient;
