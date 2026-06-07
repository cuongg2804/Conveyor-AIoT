import { Request, Response } from "express";
import {
  buildRegistryUpdate,
  deleteModelRegistry,
  getModelById,
  listModels,
  parseModelInfo,
  updateModelRegistry,
  uploadModelFile,
} from "../service/modelStorage.service";


const maxUploadMb = () => Number(process.env.MODEL_UPLOAD_MAX_MB || 1024);

const wantsJson = (req: Request) =>
  req.xhr ||
  req.headers.accept?.includes("application/json") ||
  req.headers["content-type"]?.includes("application/json");

const renderIndex = async (
  res: Response,
  options: {
    status?: number;
    error?: string | null;
    success?: string | null;
    uploadedModel?: any;
  } = {}
) => {
  const models = await listModels();

  return res.render("models/index", {
    title: "Quản lý model",
    maxUploadMb: maxUploadMb(),
    error: options.error || null,
    success: options.success || null,
    uploadedModel: options.uploadedModel || null,
    models,
  });
};

export const index = async (req: Request, res: Response) =>
  renderIndex(res, {
    success:
      req.query.updated === "1"
        ? "Cập nhật model thành công."
        : req.query.deleted === "1"
          ? "Xóa model thành công."
          : null,
  });

export const uploadModel = async (req: Request, res: Response) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const checkpointFile = files?.model?.[0];
    const metadataFile = files?.metadata?.[0];

    if (!checkpointFile || !metadataFile) {
      if (!wantsJson(req)) {
        res.status(400);
        return renderIndex(res, {
          error: "Cần upload đủ 2 file: model .ckpt/.onnx và model_info.json.",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Cần upload đủ 2 file: model .ckpt/.onnx và model_info.json.",
      });
    }

    const registryInput = parseModelInfo(metadataFile);
    const storedModel = await uploadModelFile(checkpointFile, registryInput);

    if (!wantsJson(req)) {
      res.status(201);
      return renderIndex(res, {
        success: "Upload model thành công.",
        uploadedModel: storedModel,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Upload model thành công.",
      data: storedModel,
    });
  } catch (error: any) {
    if (!wantsJson(req)) {
      res.status(400);
      return renderIndex(res, {
        error: error?.message || "Không thể upload model.",
      });
    }

    return res.status(400).json({
      success: false,
      message: error?.message || "Không thể upload model.",
    });
  }
};

export const edit = async (req: Request, res: Response) => {
  const model = await getModelById(req.params.model_id);
  if (!model) {
    return res.status(404).send("Không tìm thấy model.");
  }

  return res.render("models/edit", {
    title: "Cập nhật model",
    model,
    error: null,
  });
};

export const update = async (req: Request, res: Response) => {
  try {
    const updateInput = buildRegistryUpdate(req.body);
    await updateModelRegistry(req.params.model_id, updateInput);
    return res.redirect("/models?updated=1");
  } catch (error: any) {
    const model = await getModelById(req.params.model_id);
    if (!model) {
      return res.status(404).send("Không tìm thấy model.");
    }

    return res.status(400).render("models/edit", {
      title: "Cập nhật model",
      model: { ...model, ...req.body },
      error: error?.message || "Không thể cập nhật model.",
    });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    await deleteModelRegistry(req.params.model_id);
    return res.redirect("/models?deleted=1");
  } catch (error: any) {
    res.status(400);
    return renderIndex(res, {
      error: error?.message || "Không thể xóa model.",
    });
  }
};
