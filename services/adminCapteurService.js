const db = require("../config/db");

let seuilsTableReady = false;
let seuilsSyncDisabled = false;

function shouldIgnoreOptionalTableError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  return (
    code === "ER_NO_SUCH_TABLE" ||
    code === "ER_TABLEACCESS_DENIED_ERROR" ||
    code === "ER_DBACCESS_DENIED_ERROR" ||
    message.includes("create command denied") ||
    message.includes("doesn't exist") ||
    message.includes("permission denied")
  );
}

function warnOptionalStep(step, error) {
  const code = String(error?.code || "UNKNOWN");
  const message = String(error?.message || "");
  console.warn(`[adminCapteurService] ${step} skipped: ${code} ${message}`);
}

async function logAuditActionSafe(connection, userId, action, capteurId, details = null) {
  try {
    await connection.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
       VALUES (?, 'capteurs', ?, 'capteur', ?, ?)` ,
      [userId || null, action, String(capteurId), details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    if (shouldIgnoreOptionalTableError(error)) {
      warnOptionalStep("audit log", error);
      return;
    }
    throw error;
  }
}

async function ensureSeuilsTable(connection) {
  if (seuilsTableReady || seuilsSyncDisabled) {
    return;
  }

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS seuils_capteurs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        capteur_id INT NOT NULL,
        usine_id INT NOT NULL,
        seuil_hc DECIMAL(12,2) NOT NULL DEFAULT 11000,
        seuil_hp DECIMAL(12,2) NOT NULL DEFAULT 11000,
        seuil_hpo DECIMAL(12,2) NOT NULL DEFAULT 11000,
        date_modification DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        modifie_par INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_capteur_usine (capteur_id, usine_id),
        CONSTRAINT fk_seuil_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id) ON DELETE CASCADE,
        CONSTRAINT fk_seuil_usine FOREIGN KEY (usine_id) REFERENCES usines(id) ON DELETE CASCADE,
        CONSTRAINT fk_seuil_user FOREIGN KEY (modifie_par) REFERENCES utilisateurs(id) ON DELETE SET NULL,
        INDEX idx_capteur_id (capteur_id),
        INDEX idx_usine_id (usine_id),
        INDEX idx_date_modification (date_modification)
      )
    `);
  } catch (error) {
    if (shouldIgnoreOptionalTableError(error)) {
      seuilsSyncDisabled = true;
      warnOptionalStep("seuils table ensure", error);
      return;
    }
    throw error;
  }

  seuilsTableReady = true;
}

async function findUsineIdByCode(usineCode) {
  if (!usineCode) return null;

  const [[usine]] = await db.query(
    `SELECT id
     FROM usines
     WHERE code = ?
     LIMIT 1`,
    [usineCode]
  );

  if (!usine) {
    const error = new Error("Usine invalide");
    error.status = 400;
    throw error;
  }

  return Number(usine.id);
}

async function syncSeuilsForCapteur(connection, capteurId, usineId, thresholds, userId) {
  if (seuilsSyncDisabled) {
    return;
  }

  const { hc, hp, hpo } = thresholds;

  // Essayer de créer la table si elle n'existe pas
  try {
    await ensureSeuilsTable(connection);
  } catch (error) {
    if (shouldIgnoreOptionalTableError(error)) {
      seuilsSyncDisabled = true;
      warnOptionalStep("seuils table ensure", error);
      return;
    }
    throw error;
  }

  if (seuilsSyncDisabled) {
    return;
  }

  // Toute opération INSERT sur seuils est optionnelle - si elle échoue, on ignore
  try {
    if (usineId) {
      await connection.query(
        `INSERT INTO seuils_capteurs (
           capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo, modifie_par, date_modification
         ) VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           seuil_hc = VALUES(seuil_hc),
           seuil_hp = VALUES(seuil_hp),
           seuil_hpo = VALUES(seuil_hpo),
           modifie_par = VALUES(modifie_par),
           date_modification = NOW()`,
        [capteurId, usineId, hc, hp, hpo, userId || null]
      );
      return;
    }

    const [usines] = await connection.query(
      `SELECT id FROM usines WHERE actif = TRUE ORDER BY id ASC`
    );

    for (const usine of usines) {
      try {
        await connection.query(
          `INSERT INTO seuils_capteurs (
             capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo, modifie_par, date_modification
           ) VALUES (?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             seuil_hc = VALUES(seuil_hc),
             seuil_hp = VALUES(seuil_hp),
             seuil_hpo = VALUES(seuil_hpo),
             modifie_par = VALUES(modifie_par),
             date_modification = NOW()`,
          [capteurId, Number(usine.id), hc, hp, hpo, userId || null]
        );
      } catch (loopError) {
        if (!shouldIgnoreOptionalTableError(loopError)) {
          throw loopError;
        }
        // Sinon on ignore et on continue la boucle
      }
    }
  } catch (error) {
    if (shouldIgnoreOptionalTableError(error)) {
      seuilsSyncDisabled = true;
      warnOptionalStep("seuils sync INSERT", error);
      return;
    }
    throw error;
  }
}

async function listCapteurs() {
  const [rows] = await db.query(
    `SELECT c.id,
            c.code,
            c.nom,
            c.frequence_secondes,
            us.code AS usine,
            c.type,
            c.description,
            c.precision,
            c.actif,
            c.puissance_souscrite_hc,
            c.puissance_souscrite_hp,
            c.puissance_souscrite_hpo
     FROM capteurs c
     LEFT JOIN usines us ON us.id = c.usine_id
     ORDER BY c.id ASC`
  );

  return rows;
}

async function createCapteur(payload, userId) {
  const {
    code,
    nom,
    usine,
    type,
    description,
    precision,
    actif = true,
    frequence_secondes,
    puissance_souscrite_hc,
    puissance_souscrite_hp,
    puissance_souscrite_hpo,
  } = payload;

  if (!code || !nom) {
    const error = new Error("code et nom sont obligatoires");
    error.status = 400;
    throw error;
  }

  const usineId = await findUsineIdByCode(usine);

  const frequenceInput = Number(frequence_secondes);
  const frequence = Number.isFinite(frequenceInput) && frequenceInput > 0 ? Math.floor(frequenceInput) : 60;

  const seuilHc = Number(puissance_souscrite_hc ?? 11000);
  const seuilHp = Number(puissance_souscrite_hp ?? 11000);
  const seuilHpo = Number(puissance_souscrite_hpo ?? 11000);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO capteurs (
         code, nom, frequence_secondes, usine_id, type, description, precision, actif,
         puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        nom,
        frequence,
        usineId,
        type || null,
        description || null,
        precision || null,
        Boolean(actif),
        seuilHc,
        seuilHp,
        seuilHpo,
      ]
    );

    const capteurId = Number(result.insertId);

    // Liaison automatique vers la table seuils_capteurs (optionnelle, ne pas bloquer)
    try {
      await syncSeuilsForCapteur(
        connection,
        capteurId,
        usineId,
        { hc: seuilHc, hp: seuilHp, hpo: seuilHpo },
        userId
      );
    } catch (seuilError) {
      console.warn(`[createCapteur] seuils sync failed for capteur ${capteurId}: ${seuilError.message}`);
    }

    await logAuditActionSafe(connection, userId, "create", capteurId, {
      code,
      usine: usine || null,
    });

    await connection.commit();
    return capteurId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateCapteur(id, payload, userId) {
  const {
    nom,
    usine,
    type,
    description,
    precision,
    actif,
    frequence_secondes,
    puissance_souscrite_hc,
    puissance_souscrite_hp,
    puissance_souscrite_hpo,
  } = payload;

  if (!id || !nom) {
    const error = new Error("id et nom sont obligatoires");
    error.status = 400;
    throw error;
  }

  const usineId = await findUsineIdByCode(usine);
  const frequenceInput = Number(frequence_secondes);
  const frequenceUpdate =
    Number.isFinite(frequenceInput) && frequenceInput > 0 ? Math.floor(frequenceInput) : null;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `UPDATE capteurs
       SET nom = ?,
           frequence_secondes = COALESCE(?, frequence_secondes),
           usine_id = ?,
           type = ?,
           description = ?,
           precision = ?,
           actif = COALESCE(?, actif),
           puissance_souscrite_hc = COALESCE(?, puissance_souscrite_hc),
           puissance_souscrite_hp = COALESCE(?, puissance_souscrite_hp),
           puissance_souscrite_hpo = COALESCE(?, puissance_souscrite_hpo)
       WHERE id = ?`,
      [
        nom,
        frequenceUpdate,
        usineId,
        type || null,
        description || null,
        precision || null,
        typeof actif === "boolean" ? actif : null,
        puissance_souscrite_hc,
        puissance_souscrite_hp,
        puissance_souscrite_hpo,
        Number(id),
      ]
    );

    if (!result.affectedRows) {
      const error = new Error("Capteur introuvable");
      error.status = 404;
      throw error;
    }

    const [[capteur]] = await connection.query(
      `SELECT puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo
       FROM capteurs
       WHERE id = ?
       LIMIT 1`,
      [Number(id)]
    );

    // Liaison automatique vers la table seuils_capteurs (optionnelle, ne pas bloquer)
    try {
      await syncSeuilsForCapteur(
        connection,
        Number(id),
        usineId,
        {
          hc: Number(capteur?.puissance_souscrite_hc ?? 11000),
          hp: Number(capteur?.puissance_souscrite_hp ?? 11000),
          hpo: Number(capteur?.puissance_souscrite_hpo ?? 11000),
        },
        userId
      );
    } catch (seuilError) {
      console.warn(`[updateCapteur] seuils sync failed for capteur ${id}: ${seuilError.message}`);
    }

    await logAuditActionSafe(connection, userId, "update", id);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteCapteur(id, userId) {
  if (!id) {
    const error = new Error("ID capteur invalide");
    error.status = 400;
    throw error;
  }

  const [result] = await db.query(`DELETE FROM capteurs WHERE id = ?`, [Number(id)]);
  if (!result.affectedRows) {
    const error = new Error("Capteur introuvable");
    error.status = 404;
    throw error;
  }

  try {
    await db.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id)
       VALUES (?, 'capteurs', 'delete', 'capteur', ?)`,
      [userId || null, String(id)]
    );
  } catch (error) {
    if (shouldIgnoreOptionalTableError(error)) {
      warnOptionalStep("audit log", error);
      return;
    }
    throw error;
  }
}

module.exports = {
  listCapteurs,
  createCapteur,
  updateCapteur,
  deleteCapteur,
};
