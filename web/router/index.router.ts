import { Router } from "express";
import dashboardRoute from "./dashboard.router";
import inspectionRoute from "./inspection.router";
import historyRoute from "./history.router";
import settingRoute from "./setting.router";
import controlRoute from "./control.router";

const router = Router();

router.use("/dashboard", dashboardRoute);
router.use("/inspection", inspectionRoute);
router.use("/history", historyRoute);
router.use("/settings", settingRoute);
router.use("/control", controlRoute);

router.get("/", (_req, res) => res.redirect("/dashboard"));

export default router;
