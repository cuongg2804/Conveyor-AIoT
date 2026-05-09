import { Router } from "express";
import dashboardRoute from "./dashboard.router";
import inspectionRoute from "./inspection.router";
import historyRoute from "./history.router";
import settingRoute from "./setting.router";
import controlRoute from "./control.router";
import loginRoute from "./login.router";
import logoutRoute from "./logout.router"
import userRoute from "./user.router";

import { requireAuth } from "../middleware/auth.middleware";


const router = Router();

router.use("/dashboard", requireAuth, dashboardRoute);
router.use("/inspection", requireAuth, inspectionRoute);
router.use("/history", requireAuth, historyRoute);
router.use("/settings", requireAuth, settingRoute);
router.use("/control", requireAuth, controlRoute);
router.use("/login", loginRoute);
router.use("/logout", logoutRoute);
router.use("/users", userRoute);

router.get("/", (_req, res) => res.redirect("/dashboard"));

export default router;
