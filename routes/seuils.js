const express = require("express");
const db = require("../config/db");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth, requireRole, ROLES } = require("../middlewares/auth");

const router = express.Router();

// 📋 Récupérer tous les seuils
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `SELECT 
         id, capteur_id, usine_id, 
         seuil_hc, seuil_hp, seuil_hpo,
         DATE_FORMAT(date_modification, '%Y-%m-%d %H:%i:%s') AS date_modification,
         modifie_par
       FROM seuils_capteurs
       ORDER BY capteur_id, usine_id`
    );

    res.json(rows);
  })
);

// 📋 Récupérer seuils pour un capteur
router.get(
  "/capteur/:capteurId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const capteurId = Number(req.params.capteurId);

    const [rows] = await db.query(
      `SELECT 
         id, capteur_id, usine_id,
         seuil_hc, seuil_hp, seuil_hpo,
         DATE_FORMAT(date_modification, '%Y-%m-%d %H:%i:%s') AS date_modification
       FROM seuils_capteurs
       WHERE capteur_id = ?`,
      [capteurId]
    );

    res.json(rows);
  })
);

// 📋 Récupérer seuils pour une usine
router.get(
  "/usine/:usineId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usineId = Number(req.params.usineId);

    const [rows] = await db.query(
      `SELECT 
         sc.id, sc.capteur_id, c.code as capteur_code, c.nom as capteur_nom,
         sc.usine_id, u.code as usine_code, u.nom as usine_nom,
         sc.seuil_hc, sc.seuil_hp, sc.seuil_hpo,
         DATE_FORMAT(sc.date_modification, '%Y-%m-%d %H:%i:%s') AS date_modification
       FROM seuils_capteurs sc
       JOIN capteurs c ON c.id = sc.capteur_id
       JOIN usines u ON u.id = sc.usine_id
       WHERE sc.usine_id = ?
       ORDER BY c.code`,
      [usineId]
    );

    res.json(rows);
  })
);

// ✏️ Mettre à jour les seuils (ADMIN ONLY)
router.patch(
  "/:id",
  requireRole([ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { seuil_hc, seuil_hp, seuil_hpo } = req.body;

    if (seuil_hc == null || seuil_hp == null || seuil_hpo == null) {
      return res.status(400).json({
        message: "seuil_hc, seuil_hp et seuil_hpo sont obligatoires",
      });
    }

    const [result] = await db.query(
      `UPDATE seuils_capteurs
       SET seuil_hc = ?, seuil_hp = ?, seuil_hpo = ?,
           date_modification = NOW(),
           modifie_par = ?
       WHERE id = ?`,
      [seuil_hc, seuil_hp, seuil_hpo, req.session.user.id, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Seuil introuvable" });
    }

    res.json({ message: "Seuils mis à jour" });
  })
);

// ➕ Créer un nouveau seuil (ADMIN ONLY)
router.post(
  "/",
  requireRole([ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo } = req.body;

    if (!capteur_id || !usine_id || seuil_hc == null || seuil_hp == null || seuil_hpo == null) {
      return res.status(400).json({
        message: "capteur_id, usine_id, seuil_hc, seuil_hp et seuil_hpo sont obligatoires",
      });
    }

    const [result] = await db.query(
      `INSERT INTO seuils_capteurs 
       (capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo, modifie_par, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo, req.session.user.id]
    );

    res.status(201).json({
      id: result.insertId,
      message: "Seuil créé",
    });
  })
);

module.exports = router;
