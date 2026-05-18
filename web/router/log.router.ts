import {Router} from "express"
import * as logController from "../controller/log.controller"
import { requireAuth, requireRole } from "../middleware/auth.middleware"

const router = Router()

router.use(requireAuth, requireRole("ADMIN"))

router.get("/", logController.index)

export default router