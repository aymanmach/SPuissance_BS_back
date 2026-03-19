const express = require("express");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireRole, ROLES } = require("../middlewares/auth");
const {
  listCapteurs,
  createCapteur,
  updateCapteur,
  deleteCapteur,
} = require("../services/adminCapteurService");

const router = express.Router();

router.use(requireRole([ROLES.ADMIN]));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await listCapteurs();
    res.json(rows);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const id = await createCapteur(req.body || {}, req.session?.user?.id);
    res.status(201).json({ id, message: "Capteur cree" });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await updateCapteur(id, req.body || {}, req.session?.user?.id);

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