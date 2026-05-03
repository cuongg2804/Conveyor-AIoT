import { Router } from "express";
import * as controller from "../controller/inspection.controller";

const router = Router();

router.get("/monitor/:conveyorCode", controller.monitor);

export default router;
