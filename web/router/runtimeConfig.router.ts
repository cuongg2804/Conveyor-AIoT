import { Router } from "express";
import * as controller from "../controller/runtimeConfig.controller";

const router = Router();

router.get("/:conveyorId", controller.getRuntimeConfig);

export default router;
