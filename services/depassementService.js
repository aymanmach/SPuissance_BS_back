const db = require("../config/db");

function getTrancheFromDateTime(dateTime) {
  const date = new Date(dateTime);
  const hour = date.getHours();

  if (hour >= 22 || hour < 7) return "HC";
  if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 22)) return "HPO";
  return "HP";
}

function toMysqlDateTime(value) {
  if (!value) return null;
  return String(value).replace("T", " ");
}

function toSqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function getUsineByCode(usineCode) {
  const [rows] = await db.query(
    `SELECT id, code, nom
     FROM usines
     WHERE code = ?
     LIMIT 1`,
    [usineCode]
  );
  return rows[0] || null;
}

async function getPrincipalCapteurId(usineId) {
  const [rows] = await db.query(
    `SELECT id
     FROM capteurs
     WHERE actif = TRUE
       AND (? IS NULL OR usine_id = ?)
     ORDER BY id ASC
     LIMIT 1`,
    [usineId, usineId]
  );
  return rows[0]?.id || null;
}

async function getCapteursForUsine(usineId, limit = 3) {
  const [rows] = await db.query(
    `SELECT id, code, nom,
            puissance_souscrite_hc,
            puissance_souscrite_hp,
            puissance_souscrite_hpo
     FROM capteurs
     WHERE actif = TRUE
       AND (? IS NULL OR usine_id = ?)
     ORDER BY id ASC
     LIMIT ?`,
    [usineId, usineId, Number(limit)]
  );

  return rows;
}

function getCapteurSeuilByTranche(capteur, tranche) {
  if (tranche === "HC") return Number(capteur.puissance_souscrite_hc || 0);
  if (tranche === "HPO") return Number(capteur.puissance_souscrite_hpo || 0);
  return Number(capteur.puissance_souscrite_hp || 0);
}

function buildDefaultCapteurDistribution(totalValueKw, capteurs, tranche) {
  if (!Array.isArray(capteurs) || capteurs.length === 0) return [];

  const baseRatios = [0.44, 0.31, 0.25];
  const usedRatios = baseRatios.slice(0, capteurs.length);
  const ratioSum = usedRatios.reduce((sum, ratio) => sum + ratio, 0);

  return capteurs.map((capteur, idx) => {
    const ratio = (usedRatios[idx] || 1 / capteurs.length) / (ratioSum || 1);
    return {
      capteur_id: capteur.id,
      valeur_kw: Number((Number(totalValueKw || 0) * ratio).toFixed(3)),
      seuil_kw: Number(getCapteurSeuilByTranche(capteur, tranche).toFixed(3)),
    };
  });
}

async function logAuditAction(connection, userId, action, cibleId, details) {
  await connection.query(
    `INSERT INTO audit_actions (
      utilisateur_id, module, action, cible_type, cible_id, details
    ) VALUES (?, 'depassements', ?, 'depassement', ?, ?)`,
    [userId || null, action, String(cibleId), JSON.stringify(details || {})]
  );
}

function normalizeAllowedUsines(allowedUsines = []) {
  if (!Array.isArray(allowedUsines)) return [];
  return allowedUsines
    .map((code) => String(code || "").trim().toUpperCase())
    .filter((code) => code.length > 0);
}

function buildDepassementUsineFilter(allowedUsines = []) {
  const normalized = normalizeAllowedUsines(allowedUsines);
  if (!normalized.length) {
    return {
      joinClause: "",
      whereClause: "",
      params: [],
    };
  }

  return {
    joinClause: "JOIN usines us_scope ON us_scope.id = d.usine_id",
    whereClause: "AND us_scope.code IN (?)",
    params: [normalized],
  };
}

async function getDepassementsSynthese(capteurCode = null, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildDepassementUsineFilter(allowedUsines);
  const [rows] = await db.query(
    `SELECT d.tranche_horaire,
            COUNT(*) AS nombre_depassements,
            AVG(d.ecart_kw) AS ecart_moyen_kw,
            MAX(d.ecart_kw) AS ecart_max_kw
     FROM depassements d
     JOIN capteurs c ON c.id = d.capteur_id
     ${joinClause}
     WHERE (? IS NULL OR c.code = ?)
       ${whereClause}
     GROUP BY d.tranche_horaire
     ORDER BY d.tranche_horaire ASC`,
    [capteurCode, capteurCode, ...params]
  );

  return rows;
}

async function getDepassementsList(capteurCode = "MC02", limit = 100, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildDepassementUsineFilter(allowedUsines);
  const [rows] = await db.query(
    `SELECT d.id, d.date, d.tranche_horaire, d.pa_i_kw, d.pmc_kw, d.seuil_kw, d.ecart_kw,
            d.description, d.acquitte,
            u.code AS usine_code,
            u.nom AS usine_nom,
            c.code AS capteur_code,
            c.nom AS capteur_nom
     FROM depassements d
     LEFT JOIN capteurs c ON c.id = d.capteur_id
     LEFT JOIN usines u ON u.id = d.usine_id
     ${joinClause}
     WHERE (? IS NULL OR c.code = ?)
       ${whereClause}
     ORDER BY d.date DESC
     LIMIT ?`,
    [capteurCode || null, capteurCode || null, ...params, Number(limit)]
  );

  if (!rows.length) return rows;

  const depassementIds = rows.map((row) => row.id);
  const placeholders = depassementIds.map(() => "?").join(",");
  const [detailRows] = await db.query(
    `SELECT dc.depassement_id,
            dc.capteur_id,
            dc.valeur_kw,
            dc.seuil_kw,
            c.code,
            c.nom
     FROM depassement_capteurs dc
     JOIN capteurs c ON c.id = dc.capteur_id
     WHERE dc.depassement_id IN (${placeholders})
     ORDER BY dc.depassement_id ASC, dc.id ASC`,
    depassementIds
  );

  const detailsByDepassementId = new Map();
  for (const detail of detailRows) {
    if (!detailsByDepassementId.has(detail.depassement_id)) {
      detailsByDepassementId.set(detail.depassement_id, []);
    }
    detailsByDepassementId.get(detail.depassement_id).push({
      capteur_id: detail.capteur_id,
      code: detail.code,
      nom: detail.nom,
      valeur_kw: Number(detail.valeur_kw || 0),
      seuil_kw: Number(detail.seuil_kw || 0),
    });
  }

  return rows.map((row) => ({
    ...row,
    capteurs: detailsByDepassementId.get(row.id) || [],
  }));
}

async function createDepassementManual(payload, userId) {
  const {
    heure,
    usine,
    valeur,
    valeurSouscrite,
    marge,
    description,
    capteurId,
    capteurs,
  } = payload;

  const usineRow = await getUsineByCode(usine);
  if (!usineRow) {
    const error = new Error("Usine introuvable");
    error.status = 404;
    throw error;
  }

  const dateValue = toMysqlDateTime(heure);
  const tranche = getTrancheFromDateTime(dateValue);
  const paIKw = Number(valeur || 0);
  const seuilKw = Number(valeurSouscrite || 0);
  const ecartKw = Number(marge ?? paIKw - seuilKw);

  const principalCapteurId = Number(capteurId || (await getPrincipalCapteurId(usineRow.id)) || 0);
  if (!principalCapteurId) {
    const error = new Error("Aucun capteur actif disponible pour cette usine");
    error.status = 400;
    throw error;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [insertResult] = await connection.query(
      `INSERT INTO depassements (
        capteur_id, usine_id, date, tranche_horaire,
        pa_i_kw, pmc_kw, seuil_kw, ecart_kw, description, acquitte
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [
        principalCapteurId,
        usineRow.id,
        dateValue,
        tranche,
        paIKw,
        paIKw,
        seuilKw,
        ecartKw,
        description || "Ajout manuel",
      ]
    );

    const depassementId = insertResult.insertId;

    let detailsToInsert = [];
    if (Array.isArray(capteurs) && capteurs.length > 0) {
      detailsToInsert = capteurs
        .filter((item) => item.capteur_id)
        .map((item) => ({
          capteur_id: Number(item.capteur_id),
          valeur_kw: Number(item.valeur_kw || 0),
          seuil_kw: Number(item.seuil_kw || 0),
        }));
    } else {
      const capteursUsine = await getCapteursForUsine(usineRow.id, 3);
      detailsToInsert = buildDefaultCapteurDistribution(paIKw, capteursUsine, tranche);
    }

    for (const detail of detailsToInsert) {
      await connection.query(
        `INSERT INTO depassement_capteurs (depassement_id, capteur_id, valeur_kw, seuil_kw)
         VALUES (?, ?, ?, ?)`,
        [depassementId, detail.capteur_id, detail.valeur_kw, detail.seuil_kw]
      );
    }

    await logAuditAction(connection, userId, "create", depassementId, {
      source: "manuel",
      usine: usineRow.code,
      valeur_kw: paIKw,
      seuil_kw: seuilKw,
      ecart_kw: ecartKw,
    });

    await connection.commit();
    return depassementId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateDepassementManual(id, payload, userId) {
  const {
    heure,
    usine,
    valeur,
    valeurSouscrite,
    marge,
    description,
    capteurId,
    capteurs,
  } = payload;

  const [existingRows] = await db.query(`SELECT id FROM depassements WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!existingRows[0]) {
    const error = new Error("Depassement introuvable");
    error.status = 404;
    throw error;
  }

  const usineRow = await getUsineByCode(usine);
  if (!usineRow) {
    const error = new Error("Usine introuvable");
    error.status = 404;
    throw error;
  }

  const dateValue = toMysqlDateTime(heure);
  const tranche = getTrancheFromDateTime(dateValue);
  const paIKw = Number(valeur || 0);
  const seuilKw = Number(valeurSouscrite || 0);
  const ecartKw = Number(marge ?? paIKw - seuilKw);
  const principalCapteurId = Number(capteurId || (await getPrincipalCapteurId(usineRow.id)) || 0);

  if (!principalCapteurId) {
    const error = new Error("Aucun capteur actif disponible pour cette usine");
    error.status = 400;
    throw error;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE depassements
       SET capteur_id = ?,
           usine_id = ?,
           date = ?,
           tranche_horaire = ?,
           pa_i_kw = ?,
           pmc_kw = ?,
           seuil_kw = ?,
           ecart_kw = ?,
           description = ?
       WHERE id = ?`,
      [
        principalCapteurId,
        usineRow.id,
        dateValue,
        tranche,
        paIKw,
        paIKw,
        seuilKw,
        ecartKw,
        description || "Edition manuelle",
        Number(id),
      ]
    );

    await connection.query(`DELETE FROM depassement_capteurs WHERE depassement_id = ?`, [Number(id)]);

    let detailsToInsert = [];
    if (Array.isArray(capteurs) && capteurs.length > 0) {
      detailsToInsert = capteurs
        .filter((item) => item.capteur_id)
        .map((item) => ({
          capteur_id: Number(item.capteur_id),
          valeur_kw: Number(item.valeur_kw || 0),
          seuil_kw: Number(item.seuil_kw || 0),
        }));
    } else {
      const capteursUsine = await getCapteursForUsine(usineRow.id, 3);
      detailsToInsert = buildDefaultCapteurDistribution(paIKw, capteursUsine, tranche);
    }

    for (const detail of detailsToInsert) {
      await connection.query(
        `INSERT INTO depassement_capteurs (depassement_id, capteur_id, valeur_kw, seuil_kw)
         VALUES (?, ?, ?, ?)`,
        [Number(id), detail.capteur_id, detail.valeur_kw, detail.seuil_kw]
      );
    }

    await logAuditAction(connection, userId, "update", id, {
      source: "manuel",
      usine: usineRow.code,
      valeur_kw: paIKw,
      seuil_kw: seuilKw,
      ecart_kw: ecartKw,
    });

    await connection.commit();
    return Number(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteDepassementManual(id, userId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `DELETE FROM depassements WHERE id = ?`,
      [Number(id)]
    );

    if (!result.affectedRows) {
      const error = new Error("Depassement introuvable");
      error.status = 404;
      throw error;
    }

    await logAuditAction(connection, userId, "delete", id, {
      source: "manuel",
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Enregistre un depassement automatique detecte par fenetre glissante.
 *
 * @param {Object} pmcGlobale   - Donnees PMC courantes (pmc_kw, puissance_souscrite, capteurs, etc.)
 * @param {Date}   debutDepassement - Date exacte du debut du depassement continu (fournie par realtime.js)
 */
async function verifierEtEnregistrerDepassementAutomatique(pmcGlobale, debutDepassement) {
  if (!pmcGlobale) return { inserted: false, reason: "no-data" };

  // debutDepassement est obligatoire : c'est la fenetre glissante qui decide quand appeler
  if (!debutDepassement || !(debutDepassement instanceof Date) || Number.isNaN(debutDepassement.getTime())) {
    return { inserted: false, reason: "missing-debut-depassement" };
  }

  const pmcKw = Number(pmcGlobale.pmc_kw || 0);
  const seuilKw = Number(pmcGlobale.puissance_souscrite || 0);

  if (!seuilKw || pmcKw < seuilKw) {
    return { inserted: false, reason: "below-threshold" };
  }

  const capteurs = Array.isArray(pmcGlobale.capteurs) ? pmcGlobale.capteurs : [];

  // window_start = debut reel du depassement (fenetre glissante)
  // window_end   = debut + 10 minutes - 1 seconde
  const windowStartDate = debutDepassement;
  const windowEndDate = new Date(windowStartDate.getTime() + (10 * 60 - 1) * 1000);

  const windowStart = toSqlDateTime(windowStartDate);
  const canonicalWindowEnd = toSqlDateTime(windowEndDate);

  if (!windowStart || !canonicalWindowEnd) {
    return { inserted: false, reason: "invalid-window" };
  }

  // Tag unique base sur le debut reel du depassement (pas la grille fixe)
  const autoTag = `AUTO | ${windowStart} | ${canonicalWindowEnd}`;

  // Deduplication : eviter d'inserer deux fois le meme depassement
  const [existingRows] = await db.query(
    `SELECT id
     FROM depassements
     WHERE description LIKE CONCAT(?, '%')
     LIMIT 1`,
    [autoTag]
  );

  if (existingRows[0]) {
    return { inserted: false, reason: "already-recorded", id: existingRows[0].id };
  }

  // Capteur principal = celui avec la pmc_kw la plus haute
  const capteursValides = capteurs.filter((capteur) => Number(capteur.pmc_kw || 0) > 0);
  const capteurPrincipal =
    [...capteursValides].sort((a, b) => Number(b.pmc_kw || 0) - Number(a.pmc_kw || 0))[0] ||
    capteurs[0] ||
    null;

  if (!capteurPrincipal?.capteur_id) {
    return { inserted: false, reason: "no-capteur" };
  }

  const [usineRows] = await db.query(
    `SELECT usine_id
     FROM capteurs
     WHERE id = ?
     LIMIT 1`,
    [Number(capteurPrincipal.capteur_id)]
  );
  const usineId = usineRows[0]?.usine_id || null;

  // La tranche est determinee a partir du debut reel du depassement
  const tranche = getTrancheFromDateTime(windowStartDate);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const description = `${autoTag} Depassement glissant ( ${windowStart} ->  ${canonicalWindowEnd} )`;
    const [insertResult] = await connection.query(
      `INSERT INTO depassements (
        capteur_id, usine_id, date, tranche_horaire,
        pa_i_kw, pmc_kw, seuil_kw, ecart_kw, description, acquitte
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [
        Number(capteurPrincipal.capteur_id),
        usineId,
        canonicalWindowEnd,          // date = fin de la fenetre
        tranche,
        Number(pmcGlobale.pa_i_kw || 0),
        pmcKw,
        seuilKw,
        pmcKw - seuilKw,
        description,
      ]
    );

    const depassementId = insertResult.insertId;

    for (const capteur of capteursValides) {
      await connection.query(
        `INSERT INTO depassement_capteurs (
          depassement_id, capteur_id, valeur_kw, seuil_kw
        ) VALUES (?, ?, ?, ?)`,
        [
          depassementId,
          Number(capteur.capteur_id),
          Number(capteur.pmc_kw || 0),
          Number(capteur.puissance_souscrite || 0),
        ]
      );
    }

    await connection.commit();
    return { inserted: true, id: depassementId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// 📊 Statistiques par jour
async function getDepassementsParJour(jours = 30, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildDepassementUsineFilter(allowedUsines);
  const [rows] = await db.query(
    `SELECT DATE(d.date) AS jour,
            COUNT(*) AS nombre_depassements,
            SUM(CASE WHEN d.tranche_horaire = 'HC' THEN 1 ELSE 0 END) AS hc,
            SUM(CASE WHEN d.tranche_horaire = 'HP' THEN 1 ELSE 0 END) AS hp,
            SUM(CASE WHEN d.tranche_horaire = 'HPO' THEN 1 ELSE 0 END) AS hpo,
            AVG(d.ecart_kw) AS ecart_moyen_kw,
            MAX(d.ecart_kw) AS ecart_max_kw
     FROM depassements d
     ${joinClause}
     WHERE d.date >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ${whereClause}
     GROUP BY DATE(d.date)
     ORDER BY d.date DESC`,
    [jours, ...params]
  );

  return rows;
}

// 📊 Statistiques par capteur
async function getDepassementsParCapteur(allowedUsines = []) {
  const normalizedUsines = normalizeAllowedUsines(allowedUsines);
  const hasUsineFilter = normalizedUsines.length > 0;

  const [rows] = await db.query(
    `SELECT c.id, c.code, c.nom,
            COUNT(d.id) AS nombre_depassements,
            AVG(d.ecart_kw) AS ecart_moyen_kw,
            MAX(d.ecart_kw) AS ecart_max_kw,
            MAX(d.date) AS dernier_depassement
     FROM capteurs c
     LEFT JOIN depassements d ON d.capteur_id = c.id ${hasUsineFilter ? "AND d.usine_id = c.usine_id" : ""}
     ${hasUsineFilter ? "JOIN usines us ON us.id = c.usine_id" : ""}
     WHERE c.actif = 1
       ${hasUsineFilter ? "AND us.code IN (?)" : ""}
     GROUP BY c.id
     ORDER BY nombre_depassements DESC`,
    hasUsineFilter ? [normalizedUsines] : []
  );

  return rows;
}

// 📊 Tableau pivot: Jour x Tranche
async function getDepassementsPivot(jours = 30, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildDepassementUsineFilter(allowedUsines);
  const [rows] = await db.query(
    `SELECT DATE(d.date) AS jour,
            d.tranche_horaire,
            COUNT(*) AS nombre_depassements,
            AVG(d.ecart_kw) AS ecart_moyen_kw,
            MAX(d.ecart_kw) AS ecart_max_kw
     FROM depassements d
     ${joinClause}
     WHERE d.date >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ${whereClause}
     GROUP BY DATE(d.date), d.tranche_horaire
     ORDER BY d.date DESC, d.tranche_horaire`,
    [jours, ...params]
  );

  // Transformer en pivot object
  const pivot = {};
  rows.forEach(row => {
    const jour = row.jour.toISOString().split('T')[0];
    if (!pivot[jour]) {
      pivot[jour] = { jour, HC: null, HP: null, HPO: null, total: 0 };
    }
    pivot[jour][row.tranche_horaire] = {
      nombre: row.nombre_depassements,
      ecart_moyen: row.ecart_moyen_kw,
      ecart_max: row.ecart_max_kw,
    };
    pivot[jour].total += row.nombre_depassements;
  });

  return Object.values(pivot);
}

// 📈 Statistiques globales (tendance)
async function getDepassementsStatistiques(allowedUsines = []) {
  const { joinClause, whereClause, params } = buildDepassementUsineFilter(allowedUsines);
  const [stats] = await db.query(
    `SELECT 
      COUNT(*) AS total_depassements,
      COUNT(DISTINCT DATE(d.date)) AS jours_avec_depassements,
      SUM(CASE WHEN DATE(d.date) = CURDATE() THEN 1 ELSE 0 END) AS aujourd_hui,
      SUM(CASE WHEN DATE(d.date) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS derniers_7j,
      AVG(d.ecart_kw) AS ecart_moyen_global_kw,
      MAX(d.ecart_kw) AS ecart_max_global_kw,
      AVG(d.pa_i_kw) AS pa_i_moyen_kw,
      AVG(d.seuil_kw) AS seuil_moyen_kw
     FROM depassements d
     ${joinClause}
     WHERE 1=1
       ${whereClause}`,
    [...params]
  );

  return stats[0] || {};
}

module.exports = {
  getDepassementsSynthese,
  getDepassementsList,
  getDepassementsParJour,
  getDepassementsParCapteur,
  getDepassementsPivot,
  getDepassementsStatistiques,
  createDepassementManual,
  updateDepassementManual,
  deleteDepassementManual,
  verifierEtEnregistrerDepassementAutomatique,
};