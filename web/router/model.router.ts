import { Router } from "express";
import multer from "multer";
import * as modelController from "../controller/model.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MODEL_UPLOAD_MAX_MB || 1024) * 1024 * 1024,
  },
});

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", modelController.index);
router.get("/:id/edit", modelController.edit);
router.post("/:id/edit", modelController.update);
router.post("/:id/delete", modelController.remove);
router.post(
  "/upload",
  upload.fields([
    { name: "model", maxCount: 1 },
    { name: "metadata", maxCount: 1 },
  ]),
  modelController.uploadModel
);

export default router;
