const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");
const { getDepartsPrincipauxCourante } = require("../services/departsPrincipauxService");

const router = express.Router();

router.get(
  "/courante",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getDepartsPrincipauxCourante();
    res.json(data);
  })
);

module.exports = router;
