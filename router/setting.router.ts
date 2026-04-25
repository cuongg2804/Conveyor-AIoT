import { Router } from "express";
const router = Router();
import * as controller from "../controller/setting.controller";

router.get("/:conveyorCode", controller.settings);
router.post("/:conveyorCode", controller.updateSettings);

export default router;