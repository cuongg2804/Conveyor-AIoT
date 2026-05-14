const express = require("express");
const router = express.Router();

const controller = require("../controller/auth.login");

router.get("/", controller.login);

router.post("/", controller.loginPost);

//module.exports = router;
export default router;