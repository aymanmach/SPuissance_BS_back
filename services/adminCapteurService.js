const db = require("../config/db");

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
  const { hc, hp, hpo } = thresholds;

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
         code, nom, frequence_secondes, usine_id, type, description, actif,
         puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        nom,
        frequence,
        usineId,
        type || null,
        description || null,
        Boolean(actif),
        seuilHc,
        seuilHp,
        seuilHpo,
      ]
    );

    const capteurId = Number(result.insertId);

    // Liaison automatique vers la table seuils_capteurs
    await syncSeuilsForCapteur(
      connection,
      capteurId,
      usineId,
      { hc: seuilHc, hp: seuilHp, hpo: seuilHpo },
      userId
    );

    await connection.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id, details)
       VALUES (?, 'capteurs', 'create', 'capteur', ?, JSON_OBJECT('code', ?, 'usine', ?))`,
      [userId || null, String(capteurId), code, usine || null]
    );

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

    // Liaison automatique vers la table seuils_capteurs
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

    await connection.query(
      `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id)
       VALUES (?, 'capteurs', 'update', 'capteur', ?)`,
      [userId || null, String(id)]
    );

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

  await db.query(
    `INSERT INTO audit_actions (utilisateur_id, module, action, cible_type, cible_id)
     VALUES (?, 'capteurs', 'delete', 'capteur', ?)`,
    [userId || null, String(id)]
  );
}

module.exports = {
  listCapteurs,
  createCapteur,
  updateCapteur,
  deleteCapteur,
};
