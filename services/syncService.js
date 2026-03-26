const { getSourcePool, closeSourcePool, sql } = require("../config/sourceDb");
const db = require("../config/db");
const { detectTrancheByDate } = require("./trancheService");

const SYNC_START_DATE = process.env.SYNC_START_DATE || "2026-01-01 01:00:00";
const BUFFER_SIZE = Math.max(1, Number(process.env.SYNC_BUFFER_SIZE || 100));
const MAX_VALID_PAI = Number(process.env.MAX_VALID_PAI_KW || 500000);
const SCHEMA = String(process.env.SOURCE_DB_SCHEMA || "dbo").trim();
const REPLAY_BASE_DATE = new Date(String(SYNC_START_DATE).replace(" ", "T"));
const SYNC_WRITE_THROUGH = String(process.env.SYNC_WRITE_THROUGH || "false") === "true";
const SYNC_FLUSH_INTERVAL_MS = Math.max(1000, Number(process.env.SYNC_FLUSH_INTERVAL_MS || 5000));
const SYNC_ERROR_LOG_COOLDOWN_MS = Math.max(5000, Number(process.env.SYNC_ERROR_LOG_COOLDOWN_MS || 60000));
const SYNC_LOG_SOURCE = "SENSOR_SYNC";

const TABLE_MAP = {
  A127: "A127_MC02",
  A137: "A137_MC02",
  A138: "A138_MC02",
  A139: "A139_MC02",
  A144: "A144_MC02",
  A145: "A145_MC02",
  A146: "A146_MC02",
  A147: "A147_MC02",
  A148: "A148_MC02",
  A150: "A150_MC02",
};

const state = new Map();
const syncErrorLogState = new Map();
let started = false;
let flushTimer = null;

async function logSyncError(code, message) {
  const capteurCode = String(code || "UNKNOWN");
  const safeMessage = String(message || "Erreur sync inconnue");
  const key = `${capteurCode}:${safeMessage}`;
  const now = Date.now();
  const lastAt = Number(syncErrorLogState.get(key) || 0);

  if (now - lastAt < SYNC_ERROR_LOG_COOLDOWN_MS) {
    return;
  }

  syncErrorLogState.set(key, now);

  try {
    await db.query(
      `INSERT INTO logs_systeme (date, niveau, source, message, metadata)
       VALUES (NOW(), 'ERROR', ?, ?, JSON_OBJECT('type', 'SYNC_ERROR', 'capteur_code', ?, 'raw_error', ?))`,
      [
        SYNC_LOG_SOURCE,
        `Erreur sync capteur ${capteurCode}: ${safeMessage}`
      ]
    );
  } catch (error) {
    console.error("Impossible d'ecrire log sync en base:", error.message);
  }
}

function isValidSqlIdentifier(value) {
  return /^[A-Za-z0-9_]+$/.test(String(value || ""));
}

function buildProjectedSourceDate(now = new Date()) {
  const projected = new Date(REPLAY_BASE_DATE);
  projected.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  return projected;
}

async function initSync() {
  if (started) {
    return;
  }

  if (String(process.env.SYNC_ENABLED || "false") !== "true") {
    console.log("Sync desactivee (SYNC_ENABLED != true)");
    return;
  }

  if (!isValidSqlIdentifier(SCHEMA)) {
    throw new Error(`SOURCE_DB_SCHEMA invalide: ${SCHEMA}`);
  }

  started = true;
  console.log("Demarrage synchronisation SQL Server -> MySQL...");

  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  await db.query("TRUNCATE TABLE mesures");
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
  console.log("Table mesures videe");

  const [capteurs] = await db.query(
    `SELECT id, code, frequence_secondes
     FROM capteurs
     WHERE actif = TRUE
     ORDER BY id ASC`
  );

  if (!capteurs.length) {
    console.warn("Aucun capteur actif trouve");
    return;
  }

  for (const capteur of capteurs) {
    const tableSource = TABLE_MAP[String(capteur.code || "").toUpperCase()] || null;
    state.set(Number(capteur.id), {
      capteurId: Number(capteur.id),
      code: String(capteur.code || ""),
      tableSource,
      frequenceSecondes: Math.max(1, Number(capteur.frequence_secondes || 60)),
      cursor: buildProjectedSourceDate(),
      lastSourceDate: null,
      buffer: [],
      timer: null,
      done: false,
      lastError: null,
    });
  }

  for (const [capteurId, info] of state.entries()) {
    if (!info.tableSource) {
      info.lastError = `Table source manquante pour code ${info.code}`;
      state.set(capteurId, info);
      console.warn(info.lastError);
      continue;
    }

    if (!isValidSqlIdentifier(info.tableSource)) {
      info.lastError = `Nom de table invalide pour ${info.code}`;
      state.set(capteurId, info);
      console.warn(info.lastError);
      continue;
    }

    startLoopForCapteur(capteurId);
  }

  if (!SYNC_WRITE_THROUGH) {
    flushTimer = setInterval(() => {
      flushAll().catch((error) => {
        console.error("Erreur flush periodique sync:", error.message);
      });
    }, SYNC_FLUSH_INTERVAL_MS);
  }

  console.log(`Sync demarree pour ${state.size} capteurs`);
}

function startLoopForCapteur(capteurId) {
  const info = state.get(capteurId);
  if (!info || info.done) {
    return;
  }

  const intervalMs = info.frequenceSecondes * 1000;

  const tick = async () => {
    try {
      await readNextValue(capteurId);
    } catch (error) {
      const updated = state.get(capteurId);
      const errorMessage = error?.message || "Erreur inconnue";
      if (updated) {
        updated.lastError = errorMessage;
        state.set(capteurId, updated);
      }
      console.error(`Erreur sync capteur ${info.code}:`, errorMessage);
      await logSyncError(info.code, errorMessage);
    }
  };

  // Premiere lecture immediate pour eviter d'attendre la premiere periode.
  tick();

  const timer = setInterval(tick, intervalMs);

  info.timer = timer;
  state.set(capteurId, info);
}

async function readNextValue(capteurId) {
  const info = state.get(capteurId);
  if (!info || info.done) {
    return;
  }

  const projectedSourceDate = buildProjectedSourceDate();
  const toleranceMs = Math.max(1000, info.frequenceSecondes * 1000);
  const lowerBound = new Date(projectedSourceDate.getTime() - toleranceMs);

  const pool = await getSourcePool();
  const query = `
    SELECT TOP 1 [date], [PA_I]
    FROM [${SCHEMA}].[${info.tableSource}]
    WHERE [date] <= @projectedSourceDate
      AND [date] >= @lowerBound
      AND [PA_I] IS NOT NULL
      AND [PA_I] >= 0
      AND (@maxPai <= 0 OR [PA_I] <= @maxPai)
    ORDER BY [date] DESC
  `;

  let result = await pool
    .request()
    .input("projectedSourceDate", sql.DateTime, projectedSourceDate)
    .input("lowerBound", sql.DateTime, lowerBound)
    .input("maxPai", sql.Decimal(12, 3), MAX_VALID_PAI)
    .query(query);

  if (!result.recordset.length) {
    result = await pool
      .request()
      .input("projectedSourceDate", sql.DateTime, projectedSourceDate)
      .input("maxPai", sql.Decimal(12, 3), MAX_VALID_PAI)
      .query(`
        SELECT TOP 1 [date], [PA_I]
        FROM [${SCHEMA}].[${info.tableSource}]
        WHERE [date] <= @projectedSourceDate
          AND [PA_I] IS NOT NULL
          AND [PA_I] >= 0
          AND (@maxPai <= 0 OR [PA_I] <= @maxPai)
        ORDER BY [date] DESC
      `);
  }

  if (!result.recordset.length) {
    info.lastError = `Aucune donnee source <= ${projectedSourceDate.toISOString()}`;
    state.set(capteurId, info);
    return;
  }

  const row = result.recordset[0];
  const rowDate = new Date(row.date);
  const tranche = detectTrancheByDate(rowDate);

  if (info.lastSourceDate && String(info.lastSourceDate) === String(rowDate)) {
    info.cursor = projectedSourceDate;
    info.lastError = null;
    state.set(capteurId, info);
    return;
  }

  info.cursor = projectedSourceDate;
  info.lastSourceDate = rowDate;
  info.lastError = null;
  info.buffer.push([
    info.capteurId,
    rowDate,
    Number(row.PA_I),
    tranche,
    "OK",
    info.tableSource,
  ]);

  if (SYNC_WRITE_THROUGH || info.buffer.length >= BUFFER_SIZE) {
    await flushBuffer(capteurId);
  }

  state.set(capteurId, info);
}

async function flushBuffer(capteurId) {
  const info = state.get(capteurId);
  if (!info || !info.buffer.length) {
    return;
  }

  const rows = [...info.buffer];
  info.buffer = [];
  state.set(capteurId, info);

  try {
    await db.query(
      `INSERT IGNORE INTO mesures
         (capteur_id, date, pa_i, tranche_horaire, qualite_mesure, source_table)
       VALUES ?`,
      [rows]
    );
  } catch (error) {
    info.buffer = [...rows, ...info.buffer];
    info.lastError = error.message;
    state.set(capteurId, info);
    throw error;
  }
}

async function flushAll() {
  const capteurIds = [...state.keys()];
  for (const capteurId of capteurIds) {
    await flushBuffer(capteurId);
  }
}

async function stopSync() {
  if (!started) {
    return;
  }

  console.log("Arret synchronisation...");

  for (const info of state.values()) {
    if (info.timer) {
      clearInterval(info.timer);
      info.timer = null;
    }
  }

  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  await flushAll();
  state.clear();
  await closeSourcePool();
  started = false;

  console.log("Sync arretee proprement");
}

function getSyncStatus() {
  return [...state.values()].map((info) => ({
    code: info.code,
    table_source: info.tableSource,
    projected_source_time: info.cursor,
    last_source_date: info.lastSourceDate,
    buffer_size: info.buffer.length,
    frequence_sec: info.frequenceSecondes,
    done: info.done,
    last_error: info.lastError,
  }));
}

module.exports = {
  initSync,
  stopSync,
  getSyncStatus,
};
