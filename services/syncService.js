const { getSourcePool, closeSourcePool, sql } = require("../config/sourceDb");
const db = require("../config/db");
const { detectTrancheByDate } = require("./trancheService");
const {
  getDepartsDefinitions,
  getLatestTotalPrealByTable,
  computeDepartKw,
} = require("./departsPrincipauxService");

const SYNC_START_DATE = process.env.SYNC_START_DATE || "2026-01-01 01:00:00";
const BUFFER_SIZE = Math.max(1, Number(process.env.SYNC_BUFFER_SIZE || 100));
const MAX_VALID_PAI = Number(process.env.MAX_VALID_PAI_KW || 500000);
const SCHEMA = String(process.env.SOURCE_DB_SCHEMA || "dbo").trim();
const REPLAY_BASE_DATE = new Date(String(SYNC_START_DATE).replace(" ", "T"));
const SYNC_WRITE_THROUGH = String(process.env.SYNC_WRITE_THROUGH || "false") === "true";
const SYNC_FLUSH_INTERVAL_MS = Math.max(1000, Number(process.env.SYNC_FLUSH_INTERVAL_MS || 5000));
const SYNC_ERROR_LOG_COOLDOWN_MS = Math.max(5000, Number(process.env.SYNC_ERROR_LOG_COOLDOWN_MS || 60000));
const SYNC_SENSOR_ERROR_BACKOFF_MS = Math.max(1000, Number(process.env.SYNC_SENSOR_ERROR_BACKOFF_MS || 15000));
const SYNC_SENSOR_ERROR_BACKOFF_MAX_MS = Math.max(
  SYNC_SENSOR_ERROR_BACKOFF_MS,
  Number(process.env.SYNC_SENSOR_ERROR_BACKOFF_MAX_MS || 300000)
);
const SYNC_SOURCE_LOOKBACK_SECONDS = Math.max(1, Number(process.env.SYNC_SOURCE_LOOKBACK_SECONDS || 600));
const SYNC_SOURCE_LOOKBACK_FALLBACK_SECONDS = Math.max(
  SYNC_SOURCE_LOOKBACK_SECONDS,
  Number(process.env.SYNC_SOURCE_LOOKBACK_FALLBACK_SECONDS || 86400)
);
const SYNC_REALTIME_LOOKBACK_SECONDS = Math.max(
  SYNC_SOURCE_LOOKBACK_SECONDS,
  Number(process.env.SYNC_REALTIME_LOOKBACK_SECONDS || 2592000) // 30 jours par défaut
);
const SYNC_LOG_SOURCE = "SENSOR_SYNC";
const GLOBAL_PAI_CODE = "PAI_GLOBALE";

const SYNC_REALTIME_CAPTEURS = new Set(
  String(process.env.SYNC_REALTIME_CAPTEURS || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

function isEnvTrue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

const TABLE_MAP = {
  A127: "A127",
  A21: "A21",
  A12: "A12",
  A120: "A120",
  A128: "A128",
  A18: "A18",
  A15: "A15",
  A135: "A135",
  A137: "A137_MC02",
  A138: "A138_MC02",
  A139: "A139_MC02",
  A144: "A144_MC02",
  A145: "A145_MC02",
  A146: "A146_MC02",
  A147: "A147_MC02",
  A148: "A148_MC02",
  A150: "A150_MC02",
  A157: "A127_MC02",
  A151: "A150_MC02",
};

function normalizeCapteurCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSourceTableName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  // Accepte les formats: A150_MC02, dbo.A150_MC02, [dbo].[A150_MC02]
  const unwrapped = raw.replace(/[\[\]]/g, "");
  const parts = unwrapped.split(".");
  const tableName = String(parts[parts.length - 1] || "").trim();

  if (!tableName) {
    return null;
  }

  return tableName.toUpperCase();
}

function resolveSourceTableForCode(code) {
  const normalizedCode = normalizeCapteurCode(code);
  if (!normalizedCode) {
    return null;
  }

  const baseCode = normalizedCode.endsWith("_MC02")
    ? normalizedCode.slice(0, -"_MC02".length)
    : normalizedCode;

  // Priorite au mapping explicite pour les cas particuliers.
  if (TABLE_MAP[normalizedCode]) {
    return TABLE_MAP[normalizedCode];
  }

  if (TABLE_MAP[baseCode]) {
    return TABLE_MAP[baseCode];
  }

  if (normalizedCode.endsWith("_MC02")) {
    return isValidSqlIdentifier(normalizedCode) ? normalizedCode : null;
  }

  const inferredTable = `${normalizedCode}_MC02`;
  return isValidSqlIdentifier(inferredTable) ? inferredTable : null;
}

function resolveSourceTableForCapteur(capteur) {
  const explicitTable = normalizeSourceTableName(capteur?.table_source);
  if (explicitTable && isValidSqlIdentifier(explicitTable)) {
    return explicitTable;
  }

  return resolveSourceTableForCode(capteur?.code);
}

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
        `Erreur sync capteur ${capteurCode}: ${safeMessage}`,
        capteurCode,
        safeMessage,
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

  if (!isEnvTrue(process.env.SYNC_ENABLED)) {
    const rawValue = process.env.SYNC_ENABLED;
    const displayValue = rawValue == null ? "undefined" : JSON.stringify(String(rawValue));
    console.log(`Sync desactivee (SYNC_ENABLED=${displayValue})`);
    return;
  }

  if (!isValidSqlIdentifier(SCHEMA)) {
    throw new Error(`SOURCE_DB_SCHEMA invalide: ${SCHEMA}`);
  }

  started = true;
  console.log("Demarrage synchronisation SQL Server -> MySQL...");
  console.log("Conservation des donnees existantes dans la table mesures");

  const [capteurs] = await db.query(
    `SELECT id, code, frequence_secondes, table_source
     FROM capteurs
     WHERE actif = TRUE
     ORDER BY id ASC`
  );

  if (!capteurs.length) {
    console.warn("Aucun capteur actif trouve");
    return;
  }

  const departsDefinitions = await getDepartsDefinitions();
  const departsByCapteurId = new Map(departsDefinitions.map((d) => [Number(d.capteurId), d]));

  for (const capteur of capteurs) {
    const normalizedCode = normalizeCapteurCode(capteur.code);
    const depart = departsByCapteurId.get(Number(capteur.id));
    const isFormula = Boolean(depart);
    const isGlobalPai = normalizedCode === GLOBAL_PAI_CODE;
    const tableSource = isFormula || isGlobalPai ? null : resolveSourceTableForCapteur(capteur);
    if (tableSource) {
      console.log(
        `[SYNC] Capteur ${normalizedCode} -> table source ${tableSource}${capteur.table_source ? " (capteurs.table_source)" : " (mapping/fallback)"}`
      );
    } else if (isFormula) {
      console.log(
        `[SYNC] Capteur ${normalizedCode} -> depart calcule (${depart.parts.map((p) => `${p.operation}${p.table}`).join(" ")})`
      );
    } else if (isGlobalPai) {
      console.log(`[SYNC] Capteur ${normalizedCode} -> PAI globale (A127_MC02, echantillonnage 1s)`);
    }
    state.set(Number(capteur.id), {
      capteurId: Number(capteur.id),
      code: normalizedCode || String(capteur.code || ""),
      tableSource,
      isFormula,
      isGlobalPai,
      sousDeparts: isFormula ? depart.parts : null,
      frequenceSecondes: Math.max(1, Number(capteur.frequence_secondes || 60)),
      cursor: buildProjectedSourceDate(),
      lastSourceDate: null,
      paColumn: '[Total_Preal]',
      buffer: [],
      timer: null,
      done: false,
      lastError: null,
      inFlight: false,
      retryAt: 0,
      consecutiveErrors: 0,
    });
  }

  for (const [capteurId, info] of state.entries()) {
    if (info.isFormula || info.isGlobalPai) {
      startLoopForCapteur(capteurId);
      continue;
    }

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
    const snapshot = state.get(capteurId);
    if (!snapshot || snapshot.done) {
      return;
    }

    if (snapshot.inFlight) {
      return;
    }

    const now = Date.now();
    if (snapshot.retryAt && now < snapshot.retryAt) {
      return;
    }

    snapshot.inFlight = true;
    state.set(capteurId, snapshot);

    try {
      await readNextValue(capteurId);
      const updated = state.get(capteurId);
      if (updated) {
        updated.consecutiveErrors = 0;
        updated.retryAt = 0;
        state.set(capteurId, updated);
      }
    } catch (error) {
      const updated = state.get(capteurId);
      const errorMessage = error?.message || "Erreur inconnue";
      if (updated) {
        updated.lastError = errorMessage;
        updated.consecutiveErrors = Number(updated.consecutiveErrors || 0) + 1;
        const backoffMs = Math.min(
          SYNC_SENSOR_ERROR_BACKOFF_MAX_MS,
          SYNC_SENSOR_ERROR_BACKOFF_MS * Math.pow(2, Math.max(0, updated.consecutiveErrors - 1))
        );
        updated.retryAt = Date.now() + backoffMs;
        state.set(capteurId, updated);
      }
      console.error(`Erreur sync capteur ${info.code}:`, errorMessage);
      await logSyncError(info.code, errorMessage);
    } finally {
      const updated = state.get(capteurId);
      if (updated) {
        updated.inFlight = false;
        state.set(capteurId, updated);
      }
    }
  };

  // Premiere lecture immediate pour eviter d'attendre la premiere periode.
  tick();

  const timer = setInterval(tick, intervalMs);

  info.timer = timer;
  state.set(capteurId, info);
}

async function readNextFormulaValue(capteurId) {
  const info = state.get(capteurId);
  if (!info || info.done) {
    return;
  }

  const uniqueTables = [...new Set(info.sousDeparts.map((part) => part.table))];
  const valuesByTable = await getLatestTotalPrealByTable(uniqueTables);

  const kw = computeDepartKw({ parts: info.sousDeparts }, valuesByTable);
  if (kw === null) {
    info.lastError = `Donnees source manquantes pour le depart ${info.code}`;
    state.set(capteurId, info);
    return;
  }

  let latestSourceDate = null;
  for (const table of uniqueTables) {
    const rowDate = valuesByTable[table]?.date ? new Date(valuesByTable[table].date) : null;
    if (rowDate && (!latestSourceDate || rowDate > latestSourceDate)) {
      latestSourceDate = rowDate;
    }
  }
  const sourceDateKey = latestSourceDate ? latestSourceDate.toISOString() : null;

  if (sourceDateKey && info.lastSourceDate && String(info.lastSourceDate) === sourceDateKey) {
    info.lastError = null;
    state.set(capteurId, info);
    return;
  }

  const mesureDate = new Date();
  const tranche = detectTrancheByDate(mesureDate);

  info.lastSourceDate = sourceDateKey;
  info.lastError = null;
  info.buffer.push([info.capteurId, mesureDate, kw, tranche, "OK", uniqueTables.join("+")]);

  if (SYNC_WRITE_THROUGH || info.buffer.length >= BUFFER_SIZE) {
    await flushBuffer(capteurId);
  }

  state.set(capteurId, info);
}

async function readNextGlobalPaiValue(capteurId) {
  const info = state.get(capteurId);
  if (!info || info.done) {
    return;
  }

  const pool = await getSourcePool();
  const result = await pool.request().query(`
    SELECT TOP 1 [date], Convert(int, PA_E+PA_I) AS PA
    FROM [172.20.151.20].[ENERGIE].[dbo].[A127_MC02]
    WHERE PA_E IS NOT NULL AND PA_I IS NOT NULL
    ORDER BY [date] DESC
  `);

  if (!result.recordset.length) {
    info.lastError = "Aucune donnee A127_MC02";
    state.set(capteurId, info);
    return;
  }

  const row = result.recordset[0];
  const rowDate = new Date(row.date);
  const sourceDateKey = Number.isNaN(rowDate.getTime()) ? null : rowDate.toISOString();

  if (sourceDateKey && info.lastSourceDate && String(info.lastSourceDate) === sourceDateKey) {
    info.lastError = null;
    state.set(capteurId, info);
    return;
  }

  const mesureDate = new Date();
  const tranche = detectTrancheByDate(mesureDate);

  info.lastSourceDate = sourceDateKey;
  info.lastError = null;
  info.buffer.push([info.capteurId, mesureDate, Number(row.PA), tranche, "OK", "A127_MC02"]);

  if (SYNC_WRITE_THROUGH || info.buffer.length >= BUFFER_SIZE) {
    await flushBuffer(capteurId);
  }

  state.set(capteurId, info);
}

async function readNextValue(capteurId) {
  const info = state.get(capteurId);
  if (!info || info.done) {
    return;
  }

  if (info.isFormula) {
    return readNextFormulaValue(capteurId);
  }

  if (info.isGlobalPai) {
    return readNextGlobalPaiValue(capteurId);
  }

  const isRealtime = SYNC_REALTIME_CAPTEURS.has(info.code);
  const projectedSourceDate = isRealtime ? new Date() : buildProjectedSourceDate();
  const primaryLookbackSec = isRealtime ? SYNC_REALTIME_LOOKBACK_SECONDS : SYNC_SOURCE_LOOKBACK_SECONDS;
  const toleranceMs = Math.max(1000, primaryLookbackSec * 1000);
  const lowerBound = new Date(projectedSourceDate.getTime() - toleranceMs);

  const pool = await getSourcePool();

  const buildQuery = (expr) => `
    SELECT TOP 1 [date], ${expr} AS PA_I
    FROM [${SCHEMA}].[${info.tableSource}]
    WHERE [date] <= @projectedSourceDate
      AND [date] >= @lowerBound
      AND ${expr} IS NOT NULL
      AND ${expr} >= 0
      AND (@maxPai <= 0 OR ${expr} <= @maxPai)
    ORDER BY [date] DESC
  `;

  const runQuery = (expr, lb) => pool
    .request()
    .input("projectedSourceDate", sql.DateTime, projectedSourceDate)
    .input("lowerBound", sql.DateTime, lb || lowerBound)
    .input("maxPai", sql.Decimal(12, 3), MAX_VALID_PAI)
    .query(buildQuery(expr));

  if (isRealtime) {
    console.log(`[SYNC REALTIME] ${info.code}: fenetre [${lowerBound.toISOString()} -> ${projectedSourceDate.toISOString()}]`);
  }

  let paExpr = info.paColumn || '[Total_Preal]';
  let result;
  try {
    result = await runQuery(paExpr);
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (paExpr === '[Total_Preal]' && msg.includes('invalid column name') && msg.includes('total_preal')) {
      paExpr = '[PA_I]';
      info.paColumn = '[PA_I]';
      state.set(capteurId, info);
      result = await runQuery(paExpr);
    } else {
      if (isRealtime) console.error(`[SYNC REALTIME] ${info.code}: erreur requete:`, err.message);
      throw err;
    }
  }

  // Fallback borne: pour les capteurs non-realtime sans point dans la fenetre courte.
  if (!result.recordset.length && !isRealtime && SYNC_SOURCE_LOOKBACK_FALLBACK_SECONDS > SYNC_SOURCE_LOOKBACK_SECONDS) {
    const fallbackToleranceMs = Math.max(1000, SYNC_SOURCE_LOOKBACK_FALLBACK_SECONDS * 1000);
    const fallbackLowerBound = new Date(projectedSourceDate.getTime() - fallbackToleranceMs);

    result = await pool
      .request()
      .input("projectedSourceDate", sql.DateTime, projectedSourceDate)
      .input("lowerBound", sql.DateTime, fallbackLowerBound)
      .input("maxPai", sql.Decimal(12, 3), MAX_VALID_PAI)
      .query(buildQuery(paExpr));
  }

  if (!result.recordset.length) {
    if (isRealtime) {
      console.warn(`[SYNC REALTIME] ${info.code}: aucune donnee dans la fenetre de ${Math.round(primaryLookbackSec / 86400)} jours. Verifiez les colonnes [date] et [${paExpr}] dans la table SQL Server.`);
    }
    info.lastError = `Aucune donnee source <= ${projectedSourceDate.toISOString()}`;
    state.set(capteurId, info);
    return;
  }

  if (isRealtime) {
    console.log(`[SYNC REALTIME] ${info.code}: donnee trouvee date_source=${new Date(result.recordset[0].date).toISOString()} colonne=${paExpr} valeur=${result.recordset[0].PA_I} kW`);
  }

  const row = result.recordset[0];
  const rowDate = new Date(row.date);
  const mesureDate = new Date();
  const tranche = detectTrancheByDate(mesureDate);

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
    mesureDate,
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
    retry_at: info.retryAt ? new Date(info.retryAt).toISOString() : null,
    consecutive_errors: Number(info.consecutiveErrors || 0),
  }));
}

async function reloadSync() {
  if (!started) {
    return { added: 0, total: 0, message: "Sync non activee" };
  }

  const [capteurs] = await db.query(
    `SELECT id, code, frequence_secondes, table_source
     FROM capteurs
     WHERE actif = TRUE
     ORDER BY id ASC`
  );

  const departsDefinitions = await getDepartsDefinitions();
  const departsByCapteurId = new Map(departsDefinitions.map((d) => [Number(d.capteurId), d]));

  let added = 0;
  for (const capteur of capteurs) {
    const capteurId = Number(capteur.id);
    if (state.has(capteurId)) continue;

    const normalizedCode = normalizeCapteurCode(capteur.code);
    const depart = departsByCapteurId.get(capteurId);
    const isFormula = Boolean(depart);
    const isGlobalPai = normalizedCode === GLOBAL_PAI_CODE;
    const tableSource = isFormula || isGlobalPai ? null : resolveSourceTableForCapteur(capteur);

    const info = {
      capteurId,
      code: normalizedCode,
      tableSource,
      isFormula,
      isGlobalPai,
      sousDeparts: isFormula ? depart.parts : null,
      frequenceSecondes: Math.max(1, Number(capteur.frequence_secondes || 60)),
      cursor: buildProjectedSourceDate(),
      lastSourceDate: null,
      paColumn: '[Total_Preal]',
      buffer: [],
      timer: null,
      done: false,
      lastError: null,
      inFlight: false,
      retryAt: 0,
      consecutiveErrors: 0,
    };
    state.set(capteurId, info);

    if (isFormula || isGlobalPai) {
      startLoopForCapteur(capteurId);
      added++;
      console.log(
        isFormula
          ? `[SYNC RELOAD] Capteur ${normalizedCode} -> depart calcule (nouveau)`
          : `[SYNC RELOAD] Capteur ${normalizedCode} -> PAI globale (nouveau)`
      );
      continue;
    }

    if (!tableSource) {
      const s = state.get(capteurId);
      s.lastError = `Table source manquante pour code ${normalizedCode}`;
      state.set(capteurId, s);
      console.warn(`[SYNC RELOAD] Table source manquante pour ${normalizedCode}`);
      continue;
    }

    if (!isValidSqlIdentifier(tableSource)) {
      const s = state.get(capteurId);
      s.lastError = `Nom de table invalide pour ${normalizedCode}`;
      state.set(capteurId, s);
      console.warn(`[SYNC RELOAD] Nom de table invalide pour ${normalizedCode}`);
      continue;
    }

    startLoopForCapteur(capteurId);
    added++;
    console.log(`[SYNC RELOAD] Capteur ${normalizedCode} -> table ${tableSource} (nouveau)`);
  }

  if (added > 0) {
    console.log(`[SYNC RELOAD] ${added} nouveau(x) capteur(s) ajoute(s) a la sync`);
  }

  return { added, total: state.size };
}

module.exports = {
  initSync,
  stopSync,
  getSyncStatus,
  reloadSync,
};
