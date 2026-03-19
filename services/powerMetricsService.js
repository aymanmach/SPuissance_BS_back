const db = require("../config/db");
const { DEFAULT_SUBSCRIBED_POWER } = require("../config/constants");
const { detectTrancheByDate } = require("./trancheService");

const PMC_WINDOW_SECONDS = 600;
const MAX_VALID_PAI_KW = Number(process.env.MAX_VALID_PAI_KW || 500000);

function toSqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getCurrentTenMinuteWindowReal(now = new Date()) {
  const nowMs = now.getTime();
  const tenMinutesMs = 10 * 60 * 1000;
  const windowStartMs = Math.floor(nowMs / tenMinutesMs) * tenMinutesMs;
  const windowStart = new Date(windowStartMs);
  const windowEnd = now;

  const elapsedWindowSeconds = Math.max(0, Math.floor((windowEnd.getTime() - windowStart.getTime()) / 1000));
  const minuteCourante = Math.min(10, Math.max(1, Math.floor(elapsedWindowSeconds / 60) + 1));
  const secondeCourante = elapsedWindowSeconds % 60;

  return {
    windowStart,
    windowEnd,
    minuteCourante,
    secondeCourante,
  };
}

function getRealtimeClockPayload(now = new Date()) {
  const window = getCurrentTenMinuteWindowReal(now);
  return {
    virtual_now: toSqlDateTime(now),
    virtual_start: null,
    virtual_end: null,
    window_start: toSqlDateTime(window.windowStart),
    window_end: toSqlDateTime(window.windowEnd),
    minute_courante: window.minuteCourante,
    seconde_courante: window.secondeCourante,
    speed_factor: 1,
  };
}

async function getRealSyncNow(allowedUsines = []) {
  const { joinClause, whereClause, params } = buildUsineFilter("c", allowedUsines);
  const [[row]] = await db.query(
    `SELECT MAX(m.date) AS last_date
     FROM mesures m
     JOIN capteurs c ON c.id = m.capteur_id
     ${joinClause}
     WHERE c.actif = TRUE
       ${whereClause}`,
    [...params]
  );

  if (!row?.last_date) {
    return new Date();
  }

  return new Date(row.last_date);
}

function normalizeAllowedUsines(allowedUsines = []) {
  if (!Array.isArray(allowedUsines)) return [];
  return allowedUsines
    .map((code) => String(code || "").trim().toUpperCase())
    .filter((code) => code.length > 0);
}

function buildUsineFilter(capteurAlias, allowedUsines = []) {
  const normalized = normalizeAllowedUsines(allowedUsines);
  if (!normalized.length) {
    return {
      joinClause: "",
      whereClause: "",
      params: [],
    };
  }

  return {
    joinClause: `JOIN usines us ON us.id = ${capteurAlias}.usine_id`,
    whereClause: "AND us.code IN (?)",
    params: [normalized],
  };
}

function getSubscribedByTranche(capteur, tranche) {
  if (tranche === "HC") return Number(capteur.puissance_souscrite_hc || DEFAULT_SUBSCRIBED_POWER);
  if (tranche === "HPO") return Number(capteur.puissance_souscrite_hpo || DEFAULT_SUBSCRIBED_POWER);
  return Number(capteur.puissance_souscrite_hp || DEFAULT_SUBSCRIBED_POWER);
}

async function getLatestMeasurePerCapteur(virtualNowSql, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildUsineFilter("c", allowedUsines);
  const [rows] = await db.query(
    `SELECT c.id AS capteur_id,
            c.code,
            c.nom,
            COALESCE(c.frequence_secondes, 60) AS frequence_secondes,
            c.puissance_souscrite_hc,
            c.puissance_souscrite_hp,
            c.puissance_souscrite_hpo,
            m.date,
            m.pa_i,
            m.tranche_horaire
     FROM capteurs c
     LEFT JOIN (
       SELECT m1.*
       FROM mesures m1
       INNER JOIN (
         SELECT capteur_id, MAX(date) AS max_date
         FROM mesures
         WHERE date <= ?
           AND pa_i > 0
           AND pa_i <= ?
         GROUP BY capteur_id
       ) latest ON latest.capteur_id = m1.capteur_id AND latest.max_date = m1.date
     ) m ON m.capteur_id = c.id
     ${joinClause}
     WHERE c.actif = TRUE
       ${whereClause}
     ORDER BY c.code ASC`,
    [virtualNowSql, MAX_VALID_PAI_KW, ...params]
  );

  return rows;
}

function getExpectedPointsForCapteur(frequenceSecondes) {
  const freq = Math.max(1, Number(frequenceSecondes || 60));
  return Math.max(1, Math.floor(PMC_WINDOW_SECONDS / freq));
}

async function getWindowMeasuresByCapteur(windowStartSql, windowEndSql, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildUsineFilter("c", allowedUsines);
  const [rows] = await db.query(
    `SELECT m.capteur_id,
            c.code,
            COALESCE(c.frequence_secondes, 60) AS frequence_secondes,
            m.date,
            m.pa_i
     FROM mesures m
     JOIN capteurs c ON c.id = m.capteur_id
     ${joinClause}
     WHERE c.actif = TRUE
       ${whereClause}
       AND m.date BETWEEN ? AND ?
       AND m.pa_i > 0
       AND m.pa_i <= ?
     ORDER BY m.date ASC, m.capteur_id ASC`,
    [...params, windowStartSql, windowEndSql, MAX_VALID_PAI_KW]
  );

  return rows;
}

async function getPaiCouranteGlobale(allowedUsines = []) {
  const virtualNow = await getRealSyncNow(allowedUsines);
  const virtualNowSql = toSqlDateTime(virtualNow);
  const rows = await getLatestMeasurePerCapteur(virtualNowSql, allowedUsines);
  const trancheNow = detectTrancheByDate(virtualNow);

  const capteurs = rows.map((row) => {
    const subscribed = getSubscribedByTranche(row, trancheNow);
    const pai = Number(row.pa_i || 0);

    return {
      capteur_id: Number(row.capteur_id),
      code: row.code,
      nom: row.nom,
      date: row.date || virtualNowSql,
      pa_i: pai,
      tranche_horaire: trancheNow,
      puissance_souscrite: subscribed,
      pourcentage: subscribed ? (pai / subscribed) * 100 : 0,
    };
  });

  const pa_i = capteurs.reduce((sum, item) => sum + item.pa_i, 0);
  const puissanceSouscrite = capteurs.reduce((sum, item) => sum + item.puissance_souscrite, 0);

  return {
    ...getRealtimeClockPayload(virtualNow),
    date: virtualNowSql,
    pa_i,
    tranche_horaire: trancheNow,
    puissance_souscrite: puissanceSouscrite,
    pourcentage: puissanceSouscrite ? (pa_i / puissanceSouscrite) * 100 : 0,
    capteurs,
  };
}

async function getPaiEvolutionGlobale(debut, fin, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildUsineFilter("c", allowedUsines);
  const [rows] = await db.query(
    `SELECT t.minute_bucket AS date,
            SUM(t.avg_pa_i) AS pa_i
     FROM (
       SELECT DATE_FORMAT(m.date, '%Y-%m-%d %H:%i:00') AS minute_bucket,
              m.capteur_id,
              AVG(m.pa_i) AS avg_pa_i
       FROM mesures m
       JOIN capteurs c ON c.id = m.capteur_id
       ${joinClause}
       WHERE c.actif = TRUE
         ${whereClause}
         AND m.date BETWEEN ? AND ?
         AND m.pa_i > 0
         AND m.pa_i <= ?
       GROUP BY DATE_FORMAT(m.date, '%Y-%m-%d %H:%i:00'), m.capteur_id
     ) t
     GROUP BY t.minute_bucket
     ORDER BY t.minute_bucket ASC`,
    [...params, debut, fin, MAX_VALID_PAI_KW]
  );

  return rows.map((row) => ({
    date: row.date,
    pa_i: Number(row.pa_i || 0),
    tranche_horaire: detectTrancheByDate(row.date),
  }));
}

async function getPaiEvolutionParCapteur(debut, fin, allowedUsines = []) {
  const { joinClause, whereClause, params } = buildUsineFilter("c", allowedUsines);
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(m.date, '%Y-%m-%d %H:%i:00') AS date,
            c.code AS capteur_code,
            AVG(m.pa_i) AS pa_i
     FROM mesures m
     JOIN capteurs c ON c.id = m.capteur_id
     ${joinClause}
     WHERE c.actif = TRUE
       ${whereClause}
       AND m.date BETWEEN ? AND ?
       AND m.pa_i > 0
       AND m.pa_i <= ?
     GROUP BY DATE_FORMAT(m.date, '%Y-%m-%d %H:%i:00'), c.code
     ORDER BY date ASC, c.code ASC`,
    [...params, debut, fin, MAX_VALID_PAI_KW]
  );

  return rows.map((row) => ({
    date: row.date,
    capteur_code: row.capteur_code,
    pa_i: Number(row.pa_i || 0),
  }));
}

async function getPmcCouranteGlobale(allowedUsines = []) {
  const virtualNow = await getRealSyncNow(allowedUsines);
  const virtualNowSql = toSqlDateTime(virtualNow);
  const { windowStart, windowEnd, minuteCourante, secondeCourante } = getCurrentTenMinuteWindowReal(virtualNow);
  const windowStartSql = toSqlDateTime(windowStart);
  const windowEndSql = toSqlDateTime(windowEnd);
  const trancheNow = detectTrancheByDate(virtualNow);

  const currentRows = await getLatestMeasurePerCapteur(virtualNowSql, allowedUsines);
  const windowRows = await getWindowMeasuresByCapteur(windowStartSql, windowEndSql, allowedUsines);

  const queuesByCapteur = new Map();
  for (const row of windowRows) {
    const capteurId = Number(row.capteur_id);
    const expectedPoints = getExpectedPointsForCapteur(row.frequence_secondes);
    const queue = queuesByCapteur.get(capteurId) || [];
    queue.push(Number(row.pa_i || 0));
    if (queue.length > expectedPoints) {
      queue.shift();
    }
    queuesByCapteur.set(capteurId, queue);
  }

  const capteurs = currentRows.map((row) => {
    const subscribed = getSubscribedByTranche(row, trancheNow);
    const pai = Number(row.pa_i || 0);
    const expectedPoints = getExpectedPointsForCapteur(row.frequence_secondes);
    const queue = queuesByCapteur.get(Number(row.capteur_id)) || [];
    const pmcSum = queue.reduce((sum, value) => sum + value, 0);
    const validCount = queue.length;
    const pmc = validCount > 0 ? pmcSum / validCount : 0;

    return {
      capteur_id: Number(row.capteur_id),
      code: row.code,
      nom: row.nom,
      frequence_secondes: Number(row.frequence_secondes || 60),
      date: row.date || virtualNowSql,
      pa_i_kw: pai,
      pmc_kw: pmc,
      points_fenetre: queue.length,
      points_attendus: expectedPoints,
      tranche_horaire: trancheNow,
      puissance_souscrite: subscribed,
      pourcentage: subscribed ? (pmc / subscribed) * 100 : 0,
    };
  });

  const pa_i_kw = capteurs.reduce((sum, item) => sum + item.pa_i_kw, 0);
  const pmc_kw = capteurs.reduce((sum, item) => sum + item.pmc_kw, 0);
  const puissanceSouscrite = capteurs.reduce((sum, item) => sum + item.puissance_souscrite, 0);

  return {
    ...getRealtimeClockPayload(virtualNow),
    date: virtualNowSql,
    minute_courante: minuteCourante,
    seconde_courante: secondeCourante,
    pmc_kw,
    pa_i_kw,
    puissance_souscrite: puissanceSouscrite,
    pourcentage: puissanceSouscrite ? (pmc_kw / puissanceSouscrite) * 100 : 0,
    tranche_horaire: trancheNow,
    capteurs,
  };
}

async function getPmcEvolutionCurrentWindow(limit = 600, allowedUsines = []) {
  const virtualNow = await getRealSyncNow(allowedUsines);
  const { windowStart, windowEnd } = getCurrentTenMinuteWindowReal(virtualNow);
  const windowStartSql = toSqlDateTime(windowStart);
  const windowEndSql = toSqlDateTime(windowEnd);

  const rows = await getWindowMeasuresByCapteur(windowStartSql, windowEndSql, allowedUsines);
  const safeLimit = Math.max(1, Number(limit || 600));
  const effectiveRows = rows.slice(-safeLimit);

  const subscribedPower = await getTotalSubscribedPowerByTranche(detectTrancheByDate(virtualNow), allowedUsines);

  const latestPaiByCapteur = new Map();
  const sumByCapteur = new Map();
  const queueByCapteur = new Map();
  const expectedByCapteur = new Map();

  const points = [];

  for (const row of effectiveRows) {
    const capteurId = Number(row.capteur_id);
    const expected = getExpectedPointsForCapteur(row.frequence_secondes);
    expectedByCapteur.set(capteurId, expected);

    const queue = queueByCapteur.get(capteurId) || [];
    let runningSum = Number(sumByCapteur.get(capteurId) || 0);

    const value = Number(row.pa_i || 0);
    queue.push(value);
    runningSum += value;

    if (queue.length > expected) {
      runningSum -= Number(queue.shift() || 0);
    }

    queueByCapteur.set(capteurId, queue);
    sumByCapteur.set(capteurId, runningSum);
    latestPaiByCapteur.set(capteurId, value);

    let paiGlobal = 0;
    for (const pai of latestPaiByCapteur.values()) {
      paiGlobal += Number(pai || 0);
    }

    let pmcGlobal = 0;
    for (const [id, sum] of sumByCapteur.entries()) {
      const q = queueByCapteur.get(id) || [];
      const validCount = q.length;
      pmcGlobal += validCount > 0 ? Number(sum || 0) / validCount : 0;
    }

    const lastPoint = points[points.length - 1];
    const point = {
      date: row.date,
      pa_i_kw: paiGlobal,
      pmc_kw: pmcGlobal,
      pourcentage: subscribedPower ? (pmcGlobal / subscribedPower) * 100 : 0,
      tranche_horaire: detectTrancheByDate(row.date),
    };

    if (lastPoint && String(lastPoint.date) === String(row.date)) {
      points[points.length - 1] = point;
    } else {
      points.push(point);
    }
  }

  return points;
}

async function getPmcEvolutionParCapteurCurrentWindow(limit = 1200, allowedUsines = []) {
  const virtualNow = await getRealSyncNow(allowedUsines);
  const { windowStart, windowEnd } = getCurrentTenMinuteWindowReal(virtualNow);
  const windowStartSql = toSqlDateTime(windowStart);
  const windowEndSql = toSqlDateTime(windowEnd);

  const rows = await getWindowMeasuresByCapteur(windowStartSql, windowEndSql, allowedUsines);
  const safeLimitPerCapteur = Math.max(1, Number(limit || 120));

  const queueByCapteur = new Map();
  const sumByCapteur = new Map();

  const timeline = rows.map((row) => {
    const capteurId = Number(row.capteur_id);
    const code = row.code;
    const expected = getExpectedPointsForCapteur(row.frequence_secondes);

    const queue = queueByCapteur.get(capteurId) || [];
    let runningSum = Number(sumByCapteur.get(capteurId) || 0);

    const value = Number(row.pa_i || 0);
    queue.push(value);
    runningSum += value;

    if (queue.length > expected) {
      runningSum -= Number(queue.shift() || 0);
    }

    queueByCapteur.set(capteurId, queue);
    sumByCapteur.set(capteurId, runningSum);

    return {
      date: row.date,
      capteur_code: code,
      pmc_kw: queue.length > 0 ? runningSum / queue.length : 0,
    };
  });

  // Keep the latest N points per sensor so high-frequency sensors do not hide others.
  const countsByCode = new Map();
  const selectedDesc = [];

  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const point = timeline[i];
    const code = point.capteur_code;
    const count = Number(countsByCode.get(code) || 0);

    if (count >= safeLimitPerCapteur) {
      continue;
    }

    countsByCode.set(code, count + 1);
    selectedDesc.push(point);
  }

  return selectedDesc.reverse();
}

async function getTotalSubscribedPowerByTranche(tranche, allowedUsines = []) {
  const column = tranche === "HC"
    ? "puissance_souscrite_hc"
    : tranche === "HPO"
      ? "puissance_souscrite_hpo"
      : "puissance_souscrite_hp";

  const { joinClause, whereClause, params } = buildUsineFilter("c", allowedUsines);

  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(${column}), 0) AS total
     FROM capteurs c
     ${joinClause}
     WHERE c.actif = TRUE
       ${whereClause}`,
    [...params]
  );

  return Number(row?.total || 0);
}

module.exports = {
  getPaiCouranteGlobale,
  getPaiEvolutionGlobale,
  getPaiEvolutionParCapteur,
  getPmcCouranteGlobale,
  getPmcEvolutionCurrentWindow,
  getPmcEvolutionParCapteurCurrentWindow,
};
