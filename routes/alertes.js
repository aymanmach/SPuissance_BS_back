const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");
const db = require("../config/db");

const router = express.Router();

function normalizeAllowedUsines(allowedUsines = []) {
  if (!Array.isArray(allowedUsines)) return [];
  return allowedUsines
    .map((code) => String(code || "").trim().toUpperCase())
    .filter((code) => code.length > 0);
}

function buildUsineFilter(allowedUsines = []) {
  const normalized = normalizeAllowedUsines(allowedUsines);
  if (!normalized.length) {
    return { whereClause: "", params: [] };
  }

  return {
    whereClause: "AND us.code IN (?)",
    params: [normalized],
  };
}

function resolveUsineScope(req) {
  const role = String(req.session?.user?.role || "");
  const allowedUsines =
    role === "admin" || role === "superviseur_energie"
      ? []
      : normalizeAllowedUsines(req.session?.user?.usines || []);

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
  "/check-depassement",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = resolveUsineScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }

    const { whereClause, params } = buildUsineFilter(scope.usines);

    const [rows] = await db.query(
      `SELECT
         c.code AS capteur_code,
         c.nom AS capteur_nom,
         us.code AS usine_code,
         us.nom AS usine_nom,
         MAX(d.pa_i_kw) AS pa_i_max_kw,
         MAX(d.seuil_kw) AS seuil_kw,
         COUNT(*) AS nb_depassements,
         MIN(d.date) AS premier_depassement,
         MAX(d.date) AS dernier_depassement
       FROM depassements d
       JOIN capteurs c ON c.id = d.capteur_id
       JOIN usines us ON us.id = d.usine_id
       WHERE d.date BETWEEN DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND NOW()
         ${whereClause}
       GROUP BY c.code, c.nom, us.code, us.nom
       HAVING COUNT(*) >= 4
       ORDER BY dernier_depassement DESC`,
      [...params]
    );

    const alertes = rows.map((row) => {
      const paMax = Number(row.pa_i_max_kw || 0);
      const seuil = Number(row.seuil_kw || 0);
      const ratio = seuil > 0 ? paMax / seuil : 0;
      const severite = ratio >= 1.2 ? "CRITIQUE" : "ALERTE";

      return {
        capteurCode: row.capteur_code,
        capteurNom: row.capteur_nom,
        usineCode: row.usine_code,
        usineNom: row.usine_nom,
        paMaxKw: paMax,
        seuilKw: seuil,
        count: Number(row.nb_depassements || 0),
        severite,
        firstDate: row.premier_depassement,
        lastDate: row.dernier_depassement,
      };
    });

    res.json({
      success: true,
      alertes,
    });
  })
);

module.exports = router;
