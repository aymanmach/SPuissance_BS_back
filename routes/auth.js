const express = require("express");
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireAuth, ROLES } = require("../middlewares/auth");

const router = express.Router();

async function findUserByLogin(login) {
  const [rows] = await db.query(
    `SELECT u.id, u.login, u.nom, u.mot_de_passe_hash, u.actif, r.code AS role
     FROM utilisateurs u
     JOIN roles r ON r.id = u.role_id
     WHERE u.login = ?
     LIMIT 1`,
    [login]
  );

  return rows[0] || null;
}

async function getUserUsinesCodes(userId) {
  const [rows] = await db.query(
    `SELECT us.code
     FROM utilisateur_usines uu
     JOIN usines us ON us.id = uu.usine_id
     WHERE uu.utilisateur_id = ?
       AND us.actif = TRUE
     ORDER BY us.code ASC`,
    [userId]
  );

  return rows.map((row) => row.code);
}

function getFallbackUsinesByRole(role) {
  const roleToUsines = {
    superviseur_lac: ["LAC"],
    superviseur_acierie: ["ACIERIE"],
    superviseur_laf: ["LAF"],
    superviseur_energie: ["LAC", "ACIERIE", "LAF"],
    admin: ["LAC", "ACIERIE", "LAF"],
  };

  return roleToUsines[role] || [];
}

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "username et password sont obligatoires" });
    }

    const found = await findUserByLogin(username);
    if (!found || !found.actif) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const passwordOk = await bcrypt.compare(password, found.mot_de_passe_hash);
    if (!passwordOk) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const usines = await getUserUsinesCodes(found.id);
    const sessionUsines = usines.length ? usines : getFallbackUsinesByRole(found.role);

    req.session.user = {
      id: found.id,
      username: found.login,
      role: found.role,
      nom: found.nom,
      usines: sessionUsines,
    };

    await db.query(`UPDATE utilisateurs SET dernier_login_at = NOW() WHERE id = ?`, [found.id]);

    return res.json({ user: req.session.user });
  })
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await new Promise((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    res.clearCookie(process.env.SESSION_COOKIE_NAME || "spuissance.sid", {
      path: "/",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ message: "Session fermee" });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usines = await getUserUsinesCodes(req.session.user.id);
    const sessionUsines = usines.length ? usines : getFallbackUsinesByRole(req.session.user.role);
    res.json({
      user: {
        ...req.session.user,
        usines: sessionUsines,
      },
    });
  })
);

module.exports = router;
