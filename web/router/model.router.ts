import { Router } from "express";
import multer from "multer";
import * as modelController from "../controller/model.controller";
import { requireRole } from "../middleware/auth.middleware";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MODEL_UPLOAD_MAX_MB || 1024) * 1024 * 1024,
  },
});

router.use(requireRole("ADMIN"));

router.get("/", modelController.index);

router.post(
  "/upload",
  upload.fields([
    { name: "model", maxCount: 1 },
    { name: "metadata", maxCount: 1 },
  ]),
  modelController.uploadModel
);

router.get("/:model_id/edit", modelController.edit);
router.post("/:model_id/edit", modelController.update);
router.post("/:model_id/delete", modelController.remove);

export default router;