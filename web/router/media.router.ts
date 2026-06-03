import { Router } from "express";
import * as controller from "../controller/media.controller";

const router = Router();

router.get(/^\/minio\/([^/]+)\/(.+)$/, controller.streamMinioObject);

export default router;
