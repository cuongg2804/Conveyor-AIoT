import { Router } from "express";
import * as controller from "../controller/auth.logout";

const router = Router();

router.get("/", controller.logout);

export default router;