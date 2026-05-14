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
    title: "Quan ly model",
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
        ? "Cap nhat model thanh cong."
        : req.query.deleted === "1"
          ? "Xoa model thanh cong."
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
          error: "Can upload du 2 file: checkpoint .ckpt va model_info.json.",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Can upload du 2 file multipart/form-data: model (.ckpt) va metadata (.json).",
      });
    }

    const registryInput = parseModelInfo(metadataFile);
    const storedModel = await uploadModelFile(checkpointFile, registryInput);

    if (!wantsJson(req)) {
      res.status(201);
      return renderIndex(res, {
        success: "Upload model thanh cong.",
        uploadedModel: storedModel,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Upload model thanh cong.",
      data: storedModel,
    });
  } catch (error: any) {
    if (!wantsJson(req)) {
      res.status(400);
      return renderIndex(res, {
        error: error?.message || "Khong the upload model.",
      });
    }

    return res.status(400).json({
      success: false,
      message: error?.message || "Khong the upload model.",
    });
  }
};

export const edit = async (req: Request, res: Response) => {
  const model = await getModelById(req.params.id);
  if (!model) {
    return res.status(404).send("Khong tim thay model.");
  }

  return res.render("models/edit", {
    title: "Cap nhat model",
    model,
    error: null,
  });
};

export const update = async (req: Request, res: Response) => {
  try {
    const updateInput = buildRegistryUpdate(req.body);
    await updateModelRegistry(req.params.id, updateInput);
    return res.redirect("/models?updated=1");
  } catch (error: any) {
    const model = await getModelById(req.params.id);
    if (!model) {
      return res.status(404).send("Khong tim thay model.");
    }

    return res.status(400).render("models/edit", {
      title: "Cap nhat model",
      model: { ...model, ...req.body },
      error: error?.message || "Khong the cap nhat model.",
    });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    await deleteModelRegistry(req.params.id);
    return res.redirect("/models?deleted=1");
  } catch (error: any) {
    res.status(400);
    return renderIndex(res, {
      error: error?.message || "Khong the xoa model.",
    });
  }
};
