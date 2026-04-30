import { Router } from "express";
const router = Router();
import dashboard from "./dashboard.router";
import setting from "./setting.router";
import history from "./history.router";
import inspection from "./inspection.router";
import control from "./control.router";

router.use("/dashboard", dashboard)

router.use("/settings", setting)

router.use("/history", history)

router.use("/inspection", inspection);

router.use("/control", control);

export default router;