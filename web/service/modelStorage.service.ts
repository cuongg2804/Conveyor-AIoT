import path from "path";
import minioClient, { MINIO_BUCKET } from "../config/minio";
import ModelRegistry from "../model/modelRegister.model";

export type ModelRegistryInput = {
  model_id?: string;
  model_name: string;
  version: string;
  product_code: string;
  model_format?: "ckpt" | "onnx";
  threshold: number;
  accuracy?: number | null;
  precision?: number | null;
  recall?: number | null;
  f1_score?: number | null;
  status?: "testing" | "active" | "inactive" | "archived" | "failed";
};

export type StoredModel = ModelRegistryInput & {
  model_id: string;
  bucket: string;
  object_key: string;
  storage_type: "minio";
  model_format: "ckpt" | "onnx";
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

const allowedModelExtensions = [".ckpt", ".onnx"];

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

const allowedStatuses = ["testing", "active", "inactive", "archived", "failed"];
const normalizeModelIdPart = (value: any) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const generateModelId = (input: Pick<ModelRegistryInput, "product_code" | "version">) => {
  const productCode = normalizeModelIdPart(input.product_code);
  const version = normalizeModelIdPart(input.version);

  return `MODEL_${productCode}_${version}_${Date.now().toString(36).toUpperCase()}`;
};

export const listModels = async () => {
  return ModelRegistry.find({}).sort({ created_at: -1 }).lean();
};

export const getModelById = async (modelId: string) => {
  return ModelRegistry.findOne({
    model_id: String(modelId || "").trim(),
  }).lean();
};

export const buildRegistryUpdate = (body: any): ModelRegistryUpdate => {
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold)) {
    throw new Error("Threshold phải là số.");
  }

  const status = String(body.status || "testing").trim();
  if (!allowedStatuses.includes(status)) {
    throw new Error("Status không hợp lệ.");
  }

  const isValidMetric = (value: any, fieldName: String) => {
    if(value === undefined || value === null || value === "") {
      return undefined
    }
    const number = Number(value)
    if(!Number.isFinite(number)){
      throw new Error(`${fieldName} phải là số hợp lệ.`)
    }

    if(number < 0 || number >1){
      throw new Error(`${fieldName} phải nằm trong khoảng [0:1].`)
    }
    return number
  }
  const isValidThreshold = (value: any) => {
    const number = Number(value)
    if(!Number.isFinite(number)){
      throw new Error("Threshold phải là số hợp lệ.")
    }

    if(number < 0 ){
      throw new Error("Threshold phải nằm trong khoảng lớn hơn 0.")
    }
    return number
  }
  

  return {
    threshold: isValidThreshold(body.threshold),
    accuracy: isValidMetric(body.accuracy, "Accuracy"),
    precision: isValidMetric(body.precision, "Precision"),
    recall: isValidMetric(body.recall, "Recall"),
    f1_score: isValidMetric(body.f1_score, "F1 Score"),
    status: status as ModelRegistryUpdate["status"],
  };
};

export const updateModelRegistry = async (modelId: string, update: ModelRegistryUpdate) => {
  const model = await ModelRegistry.findByIdAndUpdate(
    {
      model_id: String(modelId || "").trim(),
    },
    { $set: update },
    {
      new: true,
      runValidators: true,
    }).lean();

  if (!model) {
    throw new Error("Không tìm thấy model.");
  }

  return model;
};

export const deleteModelRegistry = async (modelId: string) => {
  const model = await ModelRegistry.findOne({
    model_id: String(modelId || "").trim(),
  });
  if (!model) {
    throw new Error("Không tìm thấy model.");
  }

  await ModelRegistry.deleteOne({
    model_id: String(modelId || "").trim(),
  });

  if (model.storage_type === "minio" && model.bucket && model.object_key) {
    await minioClient.removeObject(model.bucket, model.object_key).catch(() => undefined);
  }

  return model;
};

export const validateModelFile = (file: Express.Multer.File) => {
  const originalName = safeFileName(file.originalname);
  const extension = path.extname(originalName).toLowerCase();

  if (!allowedModelExtensions.includes(extension)) {
    throw new Error("Model file phải có định dạng .ckpt hoặc .onnx.");
  }

  return {
    originalName,
    extension,
    modelFormat: extension.slice(1) as "ckpt" | "onnx",
  };
};

export const parseModelInfo = (file: Express.Multer.File): ModelRegistryInput => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension !== ".json") {
    throw new Error("Metadata file phải có định dạng .json.");
  }

  let metadata: any;
  try {
    metadata = JSON.parse(file.buffer.toString("utf8"));
  } catch {
    throw new Error("model_info.json không đúng định dạng JSON.");
  }

  const threshold = Number(metadata.threshold);
  const isValidMetric = (value: any, fieldName: String) => {
    if(value === undefined || value === null || value === "") {
      return undefined
    }
    const number = Number(value)
    if(!Number.isFinite(number)){
      throw new Error(`${fieldName} phải là số hợp lệ.`)
    }

    if(number < 0 || number >1){
      throw new Error(`${fieldName} phải nằm trong khoảng [0:1].`)
    }
    return number
  }
  const isValidThreshold = (value: any) => {
    const number = Number(value)
    if(!Number.isFinite(number)){
      throw new Error("Threshold phải là số hợp lệ.")
    }

    if(number < 0 ){
      throw new Error("Threshold phải nằm trong khoảng lớn hơn 0.")
    }
    return number
  }

  return {
    model_name: requiredString(metadata.model_name, "model_name"),
    version: requiredString(metadata.version, "version"),
    product_code: requiredString(metadata.product_code, "product_code").toUpperCase(),
    model_format:
      metadata.model_format === "onnx" || metadata.format === "onnx"
        ? "onnx"
        : metadata.model_format === "ckpt" || metadata.format === "ckpt"
          ? "ckpt"
          : undefined,
    threshold: isValidThreshold(threshold),
    accuracy: isValidMetric(metadata.accuracy, "Accuracy"),
    precision: isValidMetric(metadata.precision, "Precision"),
    recall: isValidMetric(metadata.recall, "Recall"),
    f1_score: isValidMetric(metadata.f1_score, "F1 Score"),
    status: "testing",
  };
};

export const uploadModelFile = async (
  file: Express.Multer.File,
  registryInput: ModelRegistryInput
): Promise<StoredModel> => {
  const modelFile = validateModelFile(file);
  const modelFormat = registryInput.model_format || modelFile.modelFormat;

  await ensureBucket();

  if (registryInput.model_format && registryInput.model_format !== modelFile.modelFormat) {
    throw new Error("model_format trong metadata không khớp với đuôi file model.");
  }

  const modelFileName = `${slugFileName(registryInput.model_name)}.${modelFormat}`;
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
      "X-Amz-Meta-Original-Name": modelFile.originalName,
      "X-Amz-Meta-Model-Format": modelFormat,
    }
  );
  const modelId = registryInput.model_id || generateModelId(registryInput);
  try {
    const registry = await ModelRegistry.create({
      ...registryInput,
      model_id: modelId,
      model_format: modelFormat,
      status: "testing",
      storage_type: "minio",
      bucket: MINIO_BUCKET,
      object_key: objectKey,
    });

    return {
      ...registryInput,
      model_id: modelId,
      model_format: modelFormat,
      status: "testing",
      storage_type: "minio",
      bucket: MINIO_BUCKET,
      object_key: objectKey,
      originalName: modelFile.originalName,
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
