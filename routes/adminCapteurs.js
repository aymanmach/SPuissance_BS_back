const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireRole, ROLES } = require("../middlewares/auth");
const {
  listCapteurs,
  createCapteur,
  updateCapteur,
  deleteCapteur,
} = require("../services/adminCapteurService");
const { reloadSync, getSyncStatus } = require("../services/syncService");

const router = express.Router();

router.use(requireRole([ROLES.ADMIN]));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await listCapteurs();
    res.json(rows);
  })
);

// Etat détaillé de la sync: capteurs en cours + capteurs actifs non syncés
router.get(
  "/sync-status",
  asyncHandler(async (req, res) => {
    const syncState = getSyncStatus();
    const syncIds = new Set(
      [...syncState].map((s) => String(s.code).toUpperCase())
    );

    const [dbCapteurs] = await require("../config/db").query(
      `SELECT c.id, c.code, c.actif, c.table_source, us.code AS usine
       FROM capteurs c
       LEFT JOIN usines us ON us.id = c.usine_id
       ORDER BY c.actif DESC, c.code ASC`
    );

    const notSyncing = dbCapteurs
      .filter((c) => c.actif && !syncIds.has(String(c.code).toUpperCase()))
      .map((c) => ({ id: c.id, code: c.code, table_source: c.table_source, usine: c.usine }));

    res.json({
      syncing: syncState,
      not_syncing_active: notSyncing,
      all_db: dbCapteurs.map((c) => ({
        id: c.id,
        code: c.code,
        actif: Boolean(c.actif),
        usine: c.usine,
        en_sync: syncIds.has(String(c.code).toUpperCase()),
      })),
    });
  })
);

// Rechargement à chaud : démarre la sync pour les capteurs actifs non encore dans la boucle
router.post(
  "/reload-sync",
  asyncHandler(async (req, res) => {
    const result = await reloadSync();
    res.json({
      message: `Sync rechargee: ${result.added} nouveau(x) capteur(s) ajoute(s)`,
      added: result.added,
      total: result.total,
    });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const id = await createCapteur(req.body || {}, req.session?.user?.id);
    // Démarrer la sync pour le nouveau capteur sans redémarrage
    reloadSync().catch((err) =>
      console.warn("[SYNC] reloadSync apres createCapteur:", err.message)
    );
    res.status(201).json({ id, message: "Capteur cree" });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await updateCapteur(id, req.body || {}, req.session?.user?.id);
    // Recharger si le capteur a été activé
    reloadSync().catch((err) =>
      console.warn("[SYNC] reloadSync apres updateCapteur:", err.message)
    );
    res.json({ message: "Capteur mis a jour" });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await deleteCapteur(id, req.session?.user?.id);
    res.json({ message: "Capteur supprime" });
  })
);

module.exports = router;
