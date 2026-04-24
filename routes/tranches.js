const express = require("express");
const db = require("../config/db");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [rows] = await db.query(
      `SELECT id, nom, saison, type_tranche, heure_debut, heure_fin
       FROM tranches_horaires
       WHERE actif = TRUE
       ORDER BY type_tranche ASC, heure_debut ASC`
    );

    res.json(rows);
  })
);

module.exports = router;
