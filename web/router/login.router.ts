import { Router } from "express";
import * as controller from "../controller/auth.login";

const router = Router();

router.get("/", controller.login);
router.post("/", controller.loginPost);

export default router;