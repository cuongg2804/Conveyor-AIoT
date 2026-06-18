import { Router } from "express";
const router = Router();
import * as controller from "../controller/history.controller";


router.get("/", controller.index);

router.get("/export/pdf", controller.exportPdf);

router.get("/:inspection_id/export/pdf", controller.exportDetailPdf);
router.get("/:inspection_id", controller.detail);

export default router;
