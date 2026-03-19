const express = require("express");
const db = require("../config/db");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userRole = String(req.session?.user?.role || "");
    const userUsines = Array.isArray(req.session?.user?.usines)
      ? req.session.user.usines.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)
      : [];
    const applyUsineFilter = userRole !== "admin" && userRole !== "superviseur_energie";

    if (applyUsineFilter && userUsines.length === 0) {
      return res.json([]);
    }

    const joinClause = applyUsineFilter ? "JOIN usines us ON us.id = c.usine_id" : "";
    const whereClause = applyUsineFilter ? "AND us.code IN (?)" : "";
    const queryParams = applyUsineFilter ? [userUsines] : [];

    const [rows] = await db.query(
      `SELECT c.id, c.code, c.nom, c.puissance_souscrite_hc, c.puissance_souscrite_hp, c.puissance_souscrite_hpo,
              c.actif,
              (
                SELECT m.tranche_horaire
                FROM mesures m
                WHERE m.capteur_id = c.id
                ORDER BY m.date DESC
                LIMIT 1
              ) AS tranche_active
       FROM capteurs c
       ${joinClause}
       WHERE c.actif = TRUE
         ${whereClause}
       ORDER BY c.code ASC`
      ,
      queryParams
    );

    res.json(rows);
  })
);

router.get(
  "/:code/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const code = String(req.params.code || "").toUpperCase();
    const userRole = String(req.session?.user?.role || "");
    const userUsines = Array.isArray(req.session?.user?.usines)
      ? req.session.user.usines.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
      : [];
    const applyUsineFilter = userRole !== "admin" && userRole !== "superviseur_energie";

    if (applyUsineFilter && userUsines.length === 0) {
      return res.status(403).json({ message: "Aucune usine autorisee pour ce profil" });
    }

    const whereClause = applyUsineFilter ? " AND us.code IN (?)" : "";
    const queryParams = applyUsineFilter
      ? [code, userUsines]
      : [code];

    const [rows] = await db.query(
      `SELECT MIN(m.pa_i) AS min_pa_i,
              MAX(m.pa_i) AS max_pa_i,
              AVG(m.pa_i) AS moyenne_pa_i,
              COUNT(*) AS nombre_mesures
       FROM mesures m
       JOIN capteurs c ON c.id = m.capteur_id
       LEFT JOIN usines us ON us.id = c.usine_id
       WHERE UPPER(c.code) = ?${whereClause}`,
      queryParams
    );

    res.json(rows[0] || null);
  })
);

module.exports = router;
