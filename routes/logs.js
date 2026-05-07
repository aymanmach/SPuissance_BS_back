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

    const user = req.session.user;
    const usines = Array.isArray(user.usines) ? user.usines : [];

    // Admin et superviseur_energie voient tous les logs
    const voitTout =
      !usines.length ||
      user.role === "admin" ||
      user.role === "superviseur" ||
      user.role === "superviseur_energie";

    let rows;
    if (voitTout) {
      [rows] = await db.query(
        `SELECT id, date, niveau, source, message
         FROM logs_systeme
         ORDER BY date DESC
         LIMIT ?`,
        [limit]
      );
    } else {
      // Filtre par usine via le capteur référencé dans metadata.capteur_id
      // Les logs sans capteur_id (logs systeme globaux) sont visibles par tous
      [rows] = await db.query(
        `SELECT l.id, l.date, l.niveau, l.source, l.message
         FROM logs_systeme l
         LEFT JOIN capteurs c
           ON c.id = CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.metadata, '$.capteur_id')), 'null') AS UNSIGNED)
         LEFT JOIN usines u ON u.id = c.usine_id
         WHERE u.code IN (?)
            OR JSON_EXTRACT(l.metadata, '$.capteur_id') IS NULL
         ORDER BY l.date DESC
         LIMIT ?`,
        [usines, limit]
      );
    }

    res.json(rows);
  })
);

module.exports = router;
