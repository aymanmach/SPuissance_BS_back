const express = require("express");
const db = require("../config/db");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");
const { getVirtualNow } = require("../services/virtualClockService");
const { ensureDailySensorErrorLogs } = require("../services/logsSystemeService");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 50);

    await ensureDailySensorErrorLogs(getVirtualNow());

    const [rows] = await db.query(
      `SELECT id, date, niveau, source, message
       FROM logs_systeme
       ORDER BY date DESC
       LIMIT ?`,
      [limit]
    );

    res.json(rows);
  })
);

module.exports = router;
