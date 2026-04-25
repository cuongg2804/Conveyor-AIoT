import { Router } from "express";
import * as controller from "../controller/control.controller";

const router = Router();

router.post("/command", controller.sendCommand);

export default router;