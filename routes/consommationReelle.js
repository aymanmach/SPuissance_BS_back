const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth } = require("../middlewares/auth");
const { getPconsReelleCourante } = require("../services/consommationReelleService");

const router = express.Router();

router.get(
  "/courante",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getPconsReelleCourante();
    if (!data) {
      return res.status(404).json({ message: "Aucune donnee disponible depuis PCons_réelle_T10DX" });
    }

    res.json(data);
  })
);

module.exports = router;
