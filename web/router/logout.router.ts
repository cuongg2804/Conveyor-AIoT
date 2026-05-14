const express = require("express");
const router = express.Router();

const controller = require("../controller/auth.logout");

router.get("/", controller.logout);


//module.exports = router;
export default router;