import { Router } from "express";
const router = Router();
import * as controller from "../controller/history.controller";

router.get("/",controller.index);

export default router;