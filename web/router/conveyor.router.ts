import { Router } from "express";
import * as conveyorController from "../controller/conveyor";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import * as setting from "../controller/setting.controller"

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", conveyorController.index);
router.get("/create", conveyorController.create);
router.post("/create", conveyorController.createPost);
router.get("/settings/:conveyor_id", setting.settings);
router.post("/settings/:conveyor_id", setting.updateSettings);
router.post("/delete/:conveyor_id", conveyorController.deleteConveyor);

export default router;