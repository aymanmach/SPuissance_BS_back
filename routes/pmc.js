const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");
const {
  getPmcCouranteGlobale,
  getPmcEvolutionCurrentWindow,
  getPmcEvolutionParCapteurCurrentWindow,
} = require("../services/powerMetricsService");

const router = express.Router();

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

router.get(
  "/courante",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const data = await getPmcCouranteGlobale(scope.usines);
    if (!data) {
      return res.status(404).json({ message: "Aucune mesure disponible" });
    }

    res.json(data);
  })
);

router.get(
  "/evolution",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawLimit = Number(req.query.limit || 600);
    const limit = Math.max(10, Math.min(rawLimit, 1200));
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getPmcEvolutionCurrentWindow(limit, scope.usines);
    res.json(rows);
  })
);

router.get(
  "/evolution-capteurs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawLimit = Number(req.query.limit || 120);
    const limit = Math.max(10, Math.min(rawLimit, 300));
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const rows = await getPmcEvolutionParCapteurCurrentWindow(limit, scope.usines);
    res.json(rows);
  })
);

module.exports = router;
