import { Router } from "express";
import * as cameraController from "../controller/camera";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import * as setting from "../controller/setting.controller"

const router = Router()

router.use(requireAuth, requireRole("ADMIN"))

router.get("/", cameraController.index);
router.get("/create", cameraController.create);
router.post("/create", cameraController.createPost);
router.get("/edit/:camera_id", cameraController.edit);
router.post("/edit/:camera_id", cameraController.editPost);
router.post("/delete/:camera_id", cameraController.deleteCamera);

export default router;