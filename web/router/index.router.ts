import { Router } from "express";
import dashboardRoute from "./dashboard.router";
import inspectionRoute from "./inspection.router";
import historyRoute from "./history.router";
import settingRoute from "./setting.router";
import controlRoute from "./control.router";
import loginRoute from "./login.router";
import logoutRoute from "./logout.router";
import userRoute from "./user.router";
import conveyorRoute from "./conveyor.router";
import cameraRoute from "./camera.router";
import modelRoute from "./model.router";
import runtimeConfigRoute from "./runtimeConfig.router";
import logRoute from "./log.router";
import mediaRoute from "./media.router";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.use("/login", loginRoute);

router.use("/dashboard", requireAuth, dashboardRoute);
router.use("/inspection", requireAuth, inspectionRoute);
router.use("/history", requireAuth, historyRoute);
router.use("/settings", requireAuth, settingRoute);
router.use("/control", requireAuth, controlRoute);
router.use("/conveyors", requireAuth, conveyorRoute);
router.use("/cameras", requireAuth, cameraRoute);
router.use("/models", requireAuth, modelRoute);
router.use("/logs", logRoute);
router.use("/media", requireAuth, mediaRoute);
router.use("/api/runtime-config", runtimeConfigRoute);
router.use("/users", requireAuth, userRoute);
router.use("/logout", requireAuth, logoutRoute);

router.get("/", (_req, res) => res.redirect("/dashboard"));

export default router;