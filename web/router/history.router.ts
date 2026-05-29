import { Router } from "express";
const router = Router();
import * as controller from "../controller/history.controller";


router.get("/", controller.index);

router.get("/export/pdf", controller.exportPdf);

router.get("/:stt/export/pdf", controller.exportDetailPdf);
router.get("/:stt", controller.detail);

export default router;
