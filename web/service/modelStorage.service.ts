import path from "path";
import minioClient, { MINIO_BUCKET } from "../config/minio";
const ModelRegistry = require("../model/modelRegister.model");

export type ModelRegistryInput = {
  model_name: string;
  version: string;
  product_code: string;
  threshold: number;
  accuracy?: number | null;
  precision?: number | null;
  recall?: number | null;
  f1_score?: number | null;
  status?: "testing" | "active" | "inactive" | "archived" | "failed";
};

export type StoredModel = ModelRegistryInput & {
  bucket: string;
  object_key: string;
  storage_type: "minio";
  originalName: string;
  size: number;
  contentType: string;
  registry_id: string;
  created_at?: Date;
};

export type ModelRegistryUpdate = {
  threshold: number;
  accuracy?: number | null;
  precision?: number | null;
  recall?: number | null;
  f1_score?: number | null;
  status: "testing" | "active" | "inactive" | "archived" | "failed";
};

const safeFileName = (fileName: string) =>
  path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");

const slugFileName = (fileName: string) =>
  safeFileName(fileName)
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const ensureBucket = async () => {
  const exists = await minioClient.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET);
  }
};

const requiredString = (value: any, field: string) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Thieu truong ${field}.`);
  return normalized;
};

const optionalNumber = (value: any) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Metric trong model_info.json phai la so.");
  return number;
};

const allowedStatuses = ["testing", "active", "inactive", "archived", "failed"];

export const listModels = async () => {
  return ModelRegistry.find({}).sort({ created_at: -1 }).lean();
};

export const getModelById = async (id: string) => {
  return ModelRegistry.findById(id).lean();
};

export const buildRegistryUpdate = (body: any): ModelRegistryUpdate => {
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold)) {
    throw new Error("Threshold phai la so.");
  }

  const status = String(body.status || "testing").trim();
  if (!allowedStatuses.includes(status)) {
    throw new Error("Status khong hop le.");
  }

  return {
    threshold,
    accuracy: optionalNumber(body.accuracy),
    precision: optionalNumber(body.precision),
    recall: optionalNumber(body.recall),
    f1_score: optionalNumber(body.f1_score),
    status: status as ModelRegistryUpdate["status"],
  };
};

export const updateModelRegistry = async (id: string, update: ModelRegistryUpdate) => {
  const model = await ModelRegistry.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  }).lean();

  if (!model) {
    throw new Error("Khong tim thay model.");
  }

  return model;
};

export const deleteModelRegistry = async (id: string) => {
  const model = await ModelRegistry.findById(id);
  if (!model) {
    throw new Error("Khong tim thay model.");
  }

  await ModelRegistry.deleteOne({ _id: id });

  if (model.storage_type === "minio" && model.bucket && model.object_key) {
    await minioClient.removeObject(model.bucket, model.object_key).catch(() => undefined);
  }

  return model;
};

export const validateCheckpointFile = (file: Express.Multer.File) => {
  const originalName = safeFileName(file.originalname);
  const extension = path.extname(originalName).toLowerCase();

  if (extension !== ".ckpt") {
    throw new Error("Checkpoint file phai co dinh dang .ckpt.");
  }

  return originalName;
};

export const parseModelInfo = (file: Express.Multer.File): ModelRegistryInput => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension !== ".json") {
    throw new Error("Metadata file phai co dinh dang .json.");
  }

  let metadata: any;
  try {
    metadata = JSON.parse(file.buffer.toString("utf8"));
  } catch {
    throw new Error("model_info.json khong dung dinh dang JSON.");
  }

  const threshold = Number(metadata.threshold);
  if (!Number.isFinite(threshold)) {
    throw new Error("model_info.json thieu threshold hoac threshold khong phai so.");
  }

  return {
    model_name: requiredString(metadata.model_name, "model_name"),
    version: requiredString(metadata.version, "version"),
    product_code: requiredString(metadata.product_code, "product_code").toUpperCase(),
    threshold,
    accuracy: optionalNumber(metadata.accuracy),
    precision: optionalNumber(metadata.precision),
    recall: optionalNumber(metadata.recall),
    f1_score: optionalNumber(metadata.f1_score),
    status: "testing",
  };
};

export const uploadModelFile = async (
  file: Express.Multer.File,
  registryInput: ModelRegistryInput
): Promise<StoredModel> => {
  const originalName = validateCheckpointFile(file);

  await ensureBucket();

  const modelFileName = `${slugFileName(registryInput.model_name)}.ckpt`;
  const objectKey = [
    "models",
    registryInput.product_code,
    registryInput.version,
    modelFileName,
  ].join("/");
  const contentType = file.mimetype || "application/octet-stream";

  await minioClient.putObject(
    MINIO_BUCKET,
    objectKey,
    file.buffer,
    file.size,
    {
      "Content-Type": contentType,
      "X-Amz-Meta-Original-Name": originalName,
    }
  );

  try {
    const registry = await ModelRegistry.create({
      ...registryInput,
      status: "testing",
      storage_type: "minio",
      bucket: MINIO_BUCKET,
      object_key: objectKey,
    });

    return {
      ...registryInput,
      status: "testing",
      storage_type: "minio",
      bucket: MINIO_BUCKET,
      object_key: objectKey,
      originalName,
      size: file.size,
      contentType,
      registry_id: String(registry._id),
      created_at: registry.created_at,
    };
  } catch (error) {
    await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => undefined);
    throw error;
  }
};