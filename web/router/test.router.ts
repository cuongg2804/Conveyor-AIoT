import { Router } from "express";
import * as testController from "../controller/test.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";


const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/settings", testController.settings);
router.post("/settings/start", testController.startTest);
router.post("/settings/stop/:test_session_id", testController.stopTest);
router.get("/settings/serial-ports", testController.scanPorts);

router.get("/history", testController.history);
router.get("/history/detail/:test_session_id", testController.detail);
router.get("/monitor/:test_session_id", testController.monitor);

export default router;