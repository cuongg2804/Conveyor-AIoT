import { Router } from "express";
import * as controller from "../controller/setting.controller";

const router = Router();

router.get("/:conveyorCode", controller.settings);
router.post("/:conveyorCode", controller.updateSettings);

export default router;
