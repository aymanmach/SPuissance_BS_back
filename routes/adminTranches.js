const express = require("express");
const db = require("../config/db");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireRole, ROLES } = require("../middlewares/auth");

const router = express.Router();

router.use(requireRole([ROLES.ADMIN]));

router.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const [rows] = await db.query(
      `SELECT a.id, a.date_action, a.action, a.cible_type, a.cible_id, a.details,
              u.nom AS acteur_nom, u.matricule AS acteur_matricule
       FROM audit_actions a
       LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
       WHERE a.module = 'tranches'
       ORDER BY a.date_action DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `SELECT id, nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif
       FROM tranches_horaires
       ORDER BY saison ASC, type_tranche ASC, heure_debut ASC`
    );

    res.json(rows);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif = true } = req.body;

    if (!nom || !saison || !type_tranche || prix_kw == null || !heure_debut || !heure_fin) {
      return res.status(400).json({
        message: "nom, saison, type_tranche, prix_kw, heure_debut et heure_fin sont obligatoires",
      });
    }

    const [result] = await db.query(
      `INSERT INTO tranches_horaires (nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nom, saison, type_tranche, Number(prix_kw), heure_debut, heure_fin, Boolean(actif)]
    );

    await db.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
       VALUES (?, 'tranches', 'create', 'tranche', ?, ?)`,
      [
        req.session.user.id,
        String(result.insertId),
        JSON.stringify({
          summary: "Création de tranche horaire",
          after: {
            id: result.insertId,
            nom,
            saison,
            type_tranche,
            prix_kw: Number(prix_kw),
            heure_debut,
            heure_fin,
            actif: Boolean(actif),
          },
          changed_fields: ["nom", "saison", "type_tranche", "prix_kw", "heure_debut", "heure_fin", "actif"],
        }),
      ]
    );

    res.status(201).json({ id: result.insertId, message: "Tranche creee" });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif } = req.body;

    if (!id || !nom || !saison || !type_tranche || prix_kw == null || !heure_debut || !heure_fin) {
      return res.status(400).json({
        message: "id, nom, saison, type_tranche, prix_kw, heure_debut et heure_fin sont obligatoires",
      });
    }

    const [[beforeTranche]] = await db.query(
      `SELECT id, nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif
       FROM tranches_horaires
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!beforeTranche) {
      return res.status(404).json({ message: "Tranche introuvable" });
    }

    const [result] = await db.query(
      `UPDATE tranches_horaires
       SET nom = ?, saison = ?, type_tranche = ?, prix_kw = ?, heure_debut = ?, heure_fin = ?, actif = COALESCE(?, actif)
       WHERE id = ?`,
      [
        nom,
        saison,
        type_tranche,
        Number(prix_kw),
        heure_debut,
        heure_fin,
        typeof actif === "boolean" ? actif : null,
        id,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Tranche introuvable" });
    }

    const afterTranche = {
      id,
      nom,
      saison,
      type_tranche,
      prix_kw: Number(prix_kw),
      heure_debut,
      heure_fin,
      actif: typeof actif === "boolean" ? actif : Boolean(beforeTranche.actif),
    };

    const changedFields = [];
    if (beforeTranche.nom !== afterTranche.nom) changedFields.push("nom");
    if (beforeTranche.saison !== afterTranche.saison) changedFields.push("saison");
    if (beforeTranche.type_tranche !== afterTranche.type_tranche) changedFields.push("type_tranche");
    if (Number(beforeTranche.prix_kw) !== Number(afterTranche.prix_kw)) changedFields.push("prix_kw");
    if (String(beforeTranche.heure_debut).slice(0, 8) !== String(afterTranche.heure_debut).slice(0, 8)) changedFields.push("heure_debut");
    if (String(beforeTranche.heure_fin).slice(0, 8) !== String(afterTranche.heure_fin).slice(0, 8)) changedFields.push("heure_fin");
    if (Boolean(beforeTranche.actif) !== Boolean(afterTranche.actif)) changedFields.push("actif");

    await db.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
       VALUES (?, 'tranches', 'update', 'tranche', ?, ?)`,
      [
        req.session.user.id,
        String(id),
        JSON.stringify({
          summary: "Modification de tranche horaire",
          changed_fields: changedFields,
          before: {
            id: beforeTranche.id,
            nom: beforeTranche.nom,
            saison: beforeTranche.saison,
            type_tranche: beforeTranche.type_tranche,
            prix_kw: Number(beforeTranche.prix_kw),
            heure_debut: beforeTranche.heure_debut,
            heure_fin: beforeTranche.heure_fin,
            actif: Boolean(beforeTranche.actif),
          },
          after: afterTranche,
        }),
      ]
    );

    res.json({ message: "Tranche mise a jour" });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ message: "ID tranche invalide" });
    }

    const [[beforeTrancheDelete]] = await db.query(
      `SELECT id, nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif
       FROM tranches_horaires
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!beforeTrancheDelete) {
      return res.status(404).json({ message: "Tranche introuvable" });
    }

    const [result] = await db.query(`DELETE FROM tranches_horaires WHERE id = ?`, [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: "Tranche introuvable" });
    }

    await db.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
       VALUES (?, 'tranches', 'delete', 'tranche', ?, ?)`,
      [
        req.session.user.id,
        String(id),
        JSON.stringify({
          summary: "Suppression de tranche horaire",
          before: {
            id: beforeTrancheDelete.id,
            nom: beforeTrancheDelete.nom,
            saison: beforeTrancheDelete.saison,
            type_tranche: beforeTrancheDelete.type_tranche,
            prix_kw: Number(beforeTrancheDelete.prix_kw),
            heure_debut: beforeTrancheDelete.heure_debut,
            heure_fin: beforeTrancheDelete.heure_fin,
            actif: Boolean(beforeTrancheDelete.actif),
          },
          reason: "Suppression via interface d'administration",
        }),
      ]
    );

    res.json({ message: "Tranche supprimee" });
  })
);

module.exports = router;