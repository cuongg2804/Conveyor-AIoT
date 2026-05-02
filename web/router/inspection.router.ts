import { Router } from "express";
import * as controller from "../controller/inspection.controller";

const router = Router();

router.get("/monitor/:conveyorCode", controller.monitor);
router.get("/latest-result", controller.getLatestResult);
router.get("/result/:jobId", controller.getResultByJobId);

export default router;
