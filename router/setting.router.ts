import { Router } from "express";
const router = Router();
import * as controller from "../controller/setting.controller";

router.get("/",controller.index);

export default router;