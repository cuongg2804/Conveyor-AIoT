import { Router } from "express";
import * as conveyorController from "../controller/conveyor";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", conveyorController.index);
router.get("/create", conveyorController.create);
router.post("/create", conveyorController.createPost);
router.post("/delete/:conveyor_id", conveyorController.deleteConveyor);

export default router;
