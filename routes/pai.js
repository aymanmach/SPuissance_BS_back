const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");
const {
  getPaiCouranteGlobale,
  getPaiEvolutionGlobale,
  getPaiEvolutionParCapteur,
} = require("../services/powerMetricsService");

const router = express.Router();
const MAX_EVOLUTION_RANGE_DAYS = 31;

function getAllowedUsinesForMetrics(req) {
  const role = String(req.session?.user?.role || "");
  if (role === "admin" || role === "superviseur_energie") {
    return [];
  }
  return req.session?.user?.usines || [];
}

function resolveUsineScope(req) {
  const allowedUsines = getAllowedUsinesForMetrics(req);
  const requestedUsine = String(req.query.usine || "").trim().toUpperCase();

  if (!requestedUsine) {
    return { ok: true, usines: allowedUsines };
  }

  if (allowedUsines.length > 0 && !allowedUsines.includes(requestedUsine)) {
    return { ok: false, status: 403, message: "Usine non autorisee" };
  }

  return { ok: true, usines: [requestedUsine] };
}

function validateDateRange(debut, fin) {
  const debutDate = new Date(String(debut));
  const finDate = new Date(String(fin));

  if (Number.isNaN(debutDate.getTime()) || Number.isNaN(finDate.getTime())) {
    return { valid: false, message: "Format de date invalide" };
  }

  if (finDate < debutDate) {
    return { valid: false, message: "La date de fin doit etre superieure a la date de debut" };
  }

  const diffDays = (finDate.getTime() - debutDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_EVOLUTION_RANGE_DAYS) {
    return { valid: false, message: `Plage maximale autorisee: ${MAX_EVOLUTION_RANGE_DAYS} jours` };
  }

  return { valid: true };
}

router.get(
  "/courante",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const payload = await getPaiCouranteGlobale(scope.usines);
    res.json(payload);
  })
);

router.get(
  "/evolution",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { debut, fin } = req.query;

    if (!debut || !fin) {
      return res.status(400).json({ message: "Parametres debut et fin obligatoires" });
    }

    const validation = validateDateRange(debut, fin);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message });
    }

    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getPaiEvolutionGlobale(debut, fin, scope.usines);
    res.json(rows);
  })
);

router.get(
  "/evolution-capteurs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { debut, fin } = req.query;

    if (!debut || !fin) {
      return res.status(400).json({ message: "Parametres debut et fin obligatoires" });
    }

    const validation = validateDateRange(debut, fin);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message });
    }

    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getPaiEvolutionParCapteur(debut, fin, scope.usines);
    res.json(rows);
  })
);

module.exports = router;
