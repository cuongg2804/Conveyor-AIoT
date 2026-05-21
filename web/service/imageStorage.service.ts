import path from "path";
import minioClient, { MINIO_IMAGE_BUCKET } from "../config/minio";

const IMAGE_BUCKET = MINIO_IMAGE_BUCKET;

const safeFileName = (fileName: string) =>
  path.basename(fileName || "image.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");

export const ensureImageBucket = async () => {
  const exists = await minioClient.bucketExists(IMAGE_BUCKET);

  if (!exists) {
    await minioClient.makeBucket(IMAGE_BUCKET);
  }
};

export const buildInspectionImageKey = (
  conveyorId: string,
  inspectionId: string,
  frameIndex: number,
  imageType: "roi" | "mask" | "overlay",
  originalName = "image.jpg"
) => {
  const ext = path.extname(originalName) || ".jpg";

  return [
    "inspection-results",
    String(conveyorId || "UNKNOWN").trim().toUpperCase(),
    String(inspectionId || "UNKNOWN").trim(),
    `frame_${frameIndex}_${imageType}${ext}`,
  ].join("/");
};

export const uploadInspectionImage = async (
  file: Express.Multer.File,
  params: {
    conveyor_id: string;
    inspection_id: string;
    frame_index: number;
    image_type: "roi" | "mask" | "overlay";
  }
) => {
  await ensureImageBucket();

  const objectKey = buildInspectionImageKey(
    params.conveyor_id,
    params.inspection_id,
    params.frame_index,
    params.image_type,
    safeFileName(file.originalname)
  );

  await minioClient.putObject(
    IMAGE_BUCKET,
    objectKey,
    file.buffer,
    file.size,
    {
      "Content-Type": file.mimetype || "image/jpeg",
      "X-Amz-Meta-Original-Name": safeFileName(file.originalname),
    }
  );

  return {
    bucket: IMAGE_BUCKET,
    object_key: objectKey,
    storage_type: "minio" as const,
  };
};

export const getInspectionImageUrl = async (
  objectKey?: string | null,
  bucket?: string | null
) => {
  if (!objectKey) return "";

  return minioClient.presignedGetObject(
    bucket || IMAGE_BUCKET,
    objectKey,
    60 * 60
  );
};

export const resolveFrameImageUrls = async (frame: any) => {
  if (!frame) return frame;

  const bucket = frame.bucket || IMAGE_BUCKET;

  return {
    ...frame,

    roi_path: frame.roi_object_key
      ? await getInspectionImageUrl(frame.roi_object_key, bucket)
      : frame.roi_path || "",

    mask_path: frame.mask_object_key
      ? await getInspectionImageUrl(frame.mask_object_key, bucket)
      : frame.mask_path || "",

    overlay_path: frame.overlay_object_key
      ? await getInspectionImageUrl(frame.overlay_object_key, bucket)
      : frame.overlay_path || "",
  };
};