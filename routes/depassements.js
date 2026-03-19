const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth, requireRole, ROLES } = require("../middlewares/auth");
const { 
  getDepassementsSynthese, 
  getDepassementsList,
  getDepassementsParJour,
  getDepassementsParCapteur,
  getDepassementsPivot,
  getDepassementsStatistiques,
  createDepassementManual,
  updateDepassementManual,
  deleteDepassementManual,
} = require("../services/depassementService");

const router = express.Router();

function getAllowedUsinesForDepassements(req) {
  const role = String(req.session?.user?.role || "");
  if (role === "admin" || role === "superviseur_energie") {
    return [];
  }
  return req.session?.user?.usines || [];
}

function resolveUsineScope(req) {
  const allowedUsines = getAllowedUsinesForDepassements(req);
  const requestedUsine = String(req.query.usine || "").trim().toUpperCase();

  if (!requestedUsine) {
    return { ok: true, usines: allowedUsines };
  }

  if (allowedUsines.length > 0 && !allowedUsines.includes(requestedUsine)) {
    return { ok: false, status: 403, message: "Usine non autorisee" };
  }

  return { ok: true, usines: [requestedUsine] };
}

router.get(
  "/synthese",
  requireAuth,
  asyncHandler(async (req, res) => {
    const capteurCode = req.query.capteur ? String(req.query.capteur) : null;
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getDepassementsSynthese(capteurCode, scope.usines);
    res.json(rows);
  })
);

router.get(
  "/liste",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 100);
    const capteurCode = req.query.capteur ? String(req.query.capteur) : null;
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getDepassementsList(capteurCode, limit, scope.usines);
    res.json(rows);
  })
);

router.post(
  "/manual",
  requireRole([ROLES.ADMIN, ROLES.SUPERVISEUR_ENERGIE]),
  asyncHandler(async (req, res) => {
    const {
      heure,
      usine,
      valeur,
      valeurSouscrite,
      marge,
      description,
      capteurId,
      capteurs,
    } = req.body || {};

    if (!heure || !usine || valeur == null || valeurSouscrite == null) {
      return res.status(400).json({
        message: "heure, usine, valeur et valeurSouscrite sont obligatoires",
      });
    }

    const depassementId = await createDepassementManual(
      {
        heure,
        usine,
        valeur,
        valeurSouscrite,
        marge,
        description,
        capteurId,
        capteurs,
      },
      req.session?.user?.id
    );

    res.status(201).json({ id: depassementId, message: "Depassement ajoute" });
  })
);

router.put(
  "/:id/manual",
  requireRole([ROLES.ADMIN, ROLES.SUPERVISEUR_ENERGIE]),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const {
      heure,
      usine,
      valeur,
      valeurSouscrite,
      marge,
      description,
      capteurId,
      capteurs,
    } = req.body || {};

    if (!heure || !usine || valeur == null || valeurSouscrite == null) {
      return res.status(400).json({
        message: "heure, usine, valeur et valeurSouscrite sont obligatoires",
      });
    }

    await updateDepassementManual(
      id,
      {
        heure,
        usine,
        valeur,
        valeurSouscrite,
        marge,
        description,
        capteurId,
        capteurs,
      },
      req.session?.user?.id
    );

    res.json({ message: "Depassement mis a jour" });
  })
);

router.delete(
  "/:id",
  requireRole([ROLES.ADMIN, ROLES.SUPERVISEUR_ENERGIE]),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "ID invalide" });
    }

    await deleteDepassementManual(id, req.session?.user?.id);
    res.json({ message: "Depassement supprime" });
  })
);

// 📊 Nouvelles routes statistiques
router.get(
  "/stats/par-jour",
  requireAuth,
  asyncHandler(async (req, res) => {
    const jours = Number(req.query.jours || 30);
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getDepassementsParJour(jours, scope.usines);
    res.json(rows);
  })
);

router.get(
  "/stats/par-capteur",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getDepassementsParCapteur(scope.usines);
    res.json(rows);
  })
);

router.get(
  "/stats/pivot",
  requireAuth,
  asyncHandler(async (req, res) => {
    const jours = Number(req.query.jours || 30);
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getDepassementsPivot(jours, scope.usines);
    res.json(rows);
  })
);

router.get(
  "/stats/global",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const stats = await getDepassementsStatistiques(scope.usines);
    res.json(stats);
  })
);

router.patch(
  "/:id/acquitter",
  requireRole([ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const db = require("../config/db");
    const id = Number(req.params.id);

    const [result] = await db.query(
      `UPDATE depassements
       SET acquitte = TRUE,
           acquitte_par = ?,
           acquitte_at = NOW()
       WHERE id = ?`,
      [req.session.user.id, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Depassement introuvable" });
    }

    res.json({ message: "Depassement acquitte" });
  })
);

module.exports = router;
