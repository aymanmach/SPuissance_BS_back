const express = require("express");
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const asyncHandler = require("../middlewares/asyncHandler");
const { requireRole, ROLES } = require("../middlewares/auth");

const router = express.Router();

function normalizeUsineCodes(usines = []) {
  if (!Array.isArray(usines)) return [];
  const normalized = usines
    .map((code) => String(code || "").trim().toUpperCase())
    .filter((code) => code.length > 0);
  return [...new Set(normalized)];
}

function enforceUsinesByRole(role, usines = []) {
  if (role === ROLES.SUPERVISEUR_LAF) {
    return ["LAF"];
  }
  return normalizeUsineCodes(usines);
}

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
       WHERE a.module = 'utilisateurs'
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
      `SELECT u.id,
              u.matricule,
              u.nom,
              u.telephone,
              u.mail,
              u.login,
              u.actif,
              r.code AS role,
              GROUP_CONCAT(us.code ORDER BY us.code SEPARATOR ',') AS usines
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN utilisateur_usines uu ON uu.utilisateur_id = u.id
       LEFT JOIN usines us ON us.id = uu.usine_id
       GROUP BY u.id, u.matricule, u.nom, u.telephone, u.mail, u.login, u.actif, r.code
       ORDER BY u.id ASC`
    );

    res.json(
      rows.map((row) => ({
        ...row,
        usines: row.usines ? row.usines.split(",") : [],
      }))
    );
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { matricule, nom, telephone, mail, login, motDePasse, motDePasseHash, role, usines = [], actif = true } =
      req.body;

    if (!matricule || !nom || !mail || !login || (!motDePasseHash && !motDePasse) || !role) {
      return res.status(400).json({
        message: "matricule, nom, mail, login, motDePasse et role sont obligatoires",
      });
    }

    const passwordHash = motDePasseHash || (await bcrypt.hash(String(motDePasse), 10));
    const usinesFinales = enforceUsinesByRole(role, usines);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[roleRow]] = await connection.query(`SELECT id FROM roles WHERE code = ? LIMIT 1`, [role]);
      if (!roleRow) {
        await connection.rollback();
        return res.status(400).json({ message: "Role invalide" });
      }

      const [insertResult] = await connection.query(
        `INSERT INTO utilisateurs (matricule, nom, telephone, mail, login, mot_de_passe_hash, role_id, actif)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [matricule, nom, telephone || null, mail, login, passwordHash, roleRow.id, Boolean(actif)]
      );

      const userId = insertResult.insertId;

      if (usinesFinales.length > 0) {
        const [usineRows] = await connection.query(
          `SELECT id FROM usines WHERE code IN (?) AND actif = TRUE`,
          [usinesFinales]
        );

        if (role === ROLES.SUPERVISEUR_LAF && usineRows.length !== 1) {
          await connection.rollback();
          return res.status(400).json({ message: "Configuration invalide: superviseur_laf doit etre associe a LAF" });
        }

        if (usineRows.length > 0) {
          const values = usineRows.map((row) => [userId, row.id]);
          await connection.query(
            `INSERT INTO utilisateur_usines (utilisateur_id, usine_id) VALUES ?`,
            [values]
          );
        }
      }

      await connection.query(
        `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
         VALUES (?, 'utilisateurs', 'create', 'utilisateur', ?, ?)`,
        [
          req.session.user.id,
          String(userId),
          JSON.stringify({
            summary: "Création d'utilisateur",
            after: {
              id: userId,
              matricule,
              nom,
              telephone: telephone || null,
              mail,
              login,
              role,
              actif: Boolean(actif),
              usines: usinesFinales,
            },
            changed_fields: ["matricule", "nom", "telephone", "mail", "login", "role", "actif", "usines"],
          }),
        ]
      );

      await connection.commit();
      res.status(201).json({ id: userId, message: "Utilisateur cree" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { nom, telephone, mail, role, usines = [], actif, motDePasse } = req.body;

    if (!id || !nom || !mail || !role) {
      return res.status(400).json({ message: "id, nom, mail et role sont obligatoires" });
    }

    const usinesFinales = enforceUsinesByRole(role, usines);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[beforeUser]] = await connection.query(
        `SELECT u.id, u.matricule, u.nom, u.telephone, u.mail, u.login, u.actif, r.code AS role
         FROM utilisateurs u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?
         LIMIT 1`,
        [id]
      );
      if (!beforeUser) {
        await connection.rollback();
        return res.status(404).json({ message: "Utilisateur introuvable" });
      }

      const [[roleRow]] = await connection.query(`SELECT id FROM roles WHERE code = ? LIMIT 1`, [role]);
      if (!roleRow) {
        await connection.rollback();
        return res.status(400).json({ message: "Role invalide" });
      }

      const [result] = await connection.query(
        `UPDATE utilisateurs
         SET nom = ?, telephone = ?, mail = ?, role_id = ?, actif = COALESCE(?, actif)
         WHERE id = ?`,
        [nom, telephone || null, mail, roleRow.id, typeof actif === "boolean" ? actif : null, id]
      );

      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ message: "Utilisateur introuvable" });
      }

      const afterUser = {
        id,
        matricule: beforeUser.matricule,
        nom,
        telephone: telephone || null,
        mail,
        login: beforeUser.login,
        role,
        actif: typeof actif === "boolean" ? actif : Boolean(beforeUser.actif),
      };

      const changedFields = [];
      if (beforeUser.nom !== afterUser.nom) changedFields.push("nom");
      if ((beforeUser.telephone || null) !== afterUser.telephone) changedFields.push("telephone");
      if (beforeUser.mail !== afterUser.mail) changedFields.push("mail");
      if (beforeUser.role !== afterUser.role) changedFields.push("role");
      if (Boolean(beforeUser.actif) !== Boolean(afterUser.actif)) changedFields.push("actif");
      if (motDePasse) changedFields.push("mot_de_passe");

      await connection.query(`DELETE FROM utilisateur_usines WHERE utilisateur_id = ?`, [id]);

      if (motDePasse) {
        const passwordHash = await bcrypt.hash(String(motDePasse), 10);
        await connection.query(`UPDATE utilisateurs SET mot_de_passe_hash = ? WHERE id = ?`, [passwordHash, id]);
      }

      if (usinesFinales.length > 0) {
        const [usineRows] = await connection.query(`SELECT id FROM usines WHERE code IN (?) AND actif = TRUE`, [usinesFinales]);

        if (role === ROLES.SUPERVISEUR_LAF && usineRows.length !== 1) {
          await connection.rollback();
          return res.status(400).json({ message: "Configuration invalide: superviseur_laf doit etre associe a LAF" });
        }

        if (usineRows.length > 0) {
          const values = usineRows.map((row) => [id, row.id]);
          await connection.query(`INSERT INTO utilisateur_usines (utilisateur_id, usine_id) VALUES ?`, [values]);
        }
      }

      if (changedFields.includes("role") || usinesFinales.length > 0) {
        changedFields.push("usines");
      }

      await connection.query(
        `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
         VALUES (?, 'utilisateurs', 'update', 'utilisateur', ?, ?)`,
        [
          req.session.user.id,
          String(id),
          JSON.stringify({
            summary: "Modification d'utilisateur",
            changed_fields: changedFields,
            before: {
              id: beforeUser.id,
              matricule: beforeUser.matricule,
              nom: beforeUser.nom,
              telephone: beforeUser.telephone || null,
              mail: beforeUser.mail,
              login: beforeUser.login,
              role: beforeUser.role,
              actif: Boolean(beforeUser.actif),
            },
            after: {
              ...afterUser,
              usines: usinesFinales,
            },
            security: {
              mot_de_passe_modifie: Boolean(motDePasse),
            },
          }),
        ]
      );

      await connection.commit();
      res.json({ message: "Utilisateur mis a jour" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ message: "ID utilisateur invalide" });
    }

    const [[userBeforeDelete]] = await db.query(
      `SELECT u.id, u.matricule, u.nom, u.telephone, u.mail, u.login, u.actif, r.code AS role
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [id]
    );
    if (!userBeforeDelete) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const [result] = await db.query(`DELETE FROM utilisateurs WHERE id = ?`, [id]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    await db.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
       VALUES (?, 'utilisateurs', 'delete', 'utilisateur', ?, ?)`,
      [
        req.session.user.id,
        String(id),
        JSON.stringify({
          summary: "Suppression d'utilisateur",
          before: {
            id: userBeforeDelete.id,
            matricule: userBeforeDelete.matricule,
            nom: userBeforeDelete.nom,
            telephone: userBeforeDelete.telephone || null,
            mail: userBeforeDelete.mail,
            login: userBeforeDelete.login,
            role: userBeforeDelete.role,
            actif: Boolean(userBeforeDelete.actif),
          },
          reason: "Suppression via interface d'administration",
        }),
      ]
    );

    res.json({ message: "Utilisateur supprime" });
  })
);

module.exports = router;