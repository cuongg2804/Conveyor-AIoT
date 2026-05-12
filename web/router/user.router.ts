import { Router } from "express";
import * as userController from "../controller/user.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", userController.index);
router.get("/create", userController.create);
router.post("/create", userController.createPost);
router.get("/edit/:user_id", userController.edit);
router.post("/edit/:user_id", userController.editPost);
router.post("/delete/:user_id", userController.deleteUser);

export default router;