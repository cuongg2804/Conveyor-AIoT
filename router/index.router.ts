import { Router } from "express";
const router = Router();
import dashboard from "./dashboard.router";
import setting from "./setting.router";
import history from "./history.router";
import inspection from "./inspection.router";

router.use("/dashboard", dashboard)

router.use("/setting", setting)

router.use("/history", history)

router.use("/inspection", inspection);


export default router;