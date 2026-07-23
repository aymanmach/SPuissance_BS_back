const express = require("express");

const authRoutes = require("./auth");
const paiRoutes = require("./pai");
const pmcRoutes = require("./pmc");
const capteursRoutes = require("./capteurs");
const depassementsRoutes = require("./depassements");
const tranchesRoutes = require("./tranches");
const alertesRoutes = require("./alertes");
const logsRoutes = require("./logs");
const seuilsRoutes = require("./seuils");
const adminUsersRoutes = require("./adminUsers");
const adminTranchesRoutes = require("./adminTranches");
const adminCapteursRoutes = require("./adminCapteurs");
const consommationReelleRoutes = require("./consommationReelle");
const departsPrincipauxRoutes = require("./departsPrincipaux");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/pai", paiRoutes);
router.use("/pmc", pmcRoutes);
router.use("/consommation-reelle", consommationReelleRoutes);
router.use("/departs-principaux", departsPrincipauxRoutes);
router.use("/capteurs", capteursRoutes);
router.use("/depassements", depassementsRoutes);
router.use("/tranches", tranchesRoutes);
router.use("/alertes", alertesRoutes);
router.use("/logs", logsRoutes);
router.use("/seuils", seuilsRoutes);
router.use("/admin/utilisateurs", adminUsersRoutes);
router.use("/admin/tranches", adminTranchesRoutes);
router.use("/admin/capteurs", adminCapteursRoutes);

module.exports = router;
