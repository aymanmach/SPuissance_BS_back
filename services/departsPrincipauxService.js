const { getSourcePool, sql } = require("../config/sourceDb");
const db = require("../config/db");
const { DEFAULT_SUBSCRIBED_POWER } = require("../config/constants");
const { detectTrancheByDate } = require("./trancheService");

function isValidSqlIdentifier(value) {
  return /^[A-Za-z0-9_]+$/.test(String(value || ""));
}

function toSqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
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

function getSubscribedByTranche(capteur, tranche) {
  if (tranche === "HC") return Number(capteur.puissance_souscrite_hc || DEFAULT_SUBSCRIBED_POWER);
  if (tranche === "HPO") return Number(capteur.puissance_souscrite_hpo || DEFAULT_SUBSCRIBED_POWER);
  return Number(capteur.puissance_souscrite_hp || DEFAULT_SUBSCRIBED_POWER);
}

// Les 7 departs principaux (PKB, LGA, LGB, LGP, CRMA, CRMB, COMPRESSEUR) sont des
// capteurs dont la valeur est calculee a partir de plusieurs tables source SQL Server
// combinees par + ou - (table capteur_sous_departs), au lieu d'une lecture 1:1.
async function getDepartsDefinitions() {
  const [rows] = await db.query(
    `SELECT c.id AS capteur_id, c.code, c.nom,
            c.puissance_souscrite_hc, c.puissance_souscrite_hp, c.puissance_souscrite_hpo,
            sd.table_source, sd.operation, sd.ordre
     FROM capteurs c
     JOIN capteur_sous_departs sd ON sd.capteur_id = c.id
     WHERE c.actif = TRUE
     ORDER BY c.id ASC, sd.ordre ASC`
  );

  const byCapteur = new Map();
  for (const row of rows) {
    const entry = byCapteur.get(row.capteur_id) || {
      capteurId: row.capteur_id,
      code: row.code,
      nom: row.nom,
      puissance_souscrite_hc: row.puissance_souscrite_hc,
      puissance_souscrite_hp: row.puissance_souscrite_hp,
      puissance_souscrite_hpo: row.puissance_souscrite_hpo,
      parts: [],
    };
    entry.parts.push({ table: row.table_source, operation: row.operation });
    byCapteur.set(row.capteur_id, entry);
  }

  return [...byCapteur.values()];
}

async function getLatestTotalPrealByTable(tables) {
  const validTables = [...new Set(tables)].filter(isValidSqlIdentifier);
  if (!validTables.length) {
    return {};
  }

  const pool = await getSourcePool();
  const unionQuery = validTables.map(
    (table) => `SELECT '${table}' AS table_name, val.Total_Preal AS total_preal, val.[date] AS mesure_date
                FROM (
                  SELECT TOP 1 Total_Preal, [date]
                  FROM [dbo].[${table}]
                  WHERE Total_Preal IS NOT NULL
                  ORDER BY [date] DESC
                ) val`
  ).join(" UNION ALL ");

  const result = await pool.request().query(unionQuery);

  const values = {};
  for (const row of result.recordset) {
    values[row.table_name] = { total_preal: Number(row.total_preal || 0), date: row.mesure_date };
  }
  return values;
}

function computeDepartKw(depart, valuesByTable) {
  const hasAllTables = depart.parts.every((part) => valuesByTable[part.table] !== undefined);
  if (!hasAllTables) {
    return null;
  }

  const rawWatts = depart.parts.reduce((sum, part) => {
    const value = valuesByTable[part.table].total_preal;
    return part.operation === "-" ? sum - value : sum + value;
  }, 0);

  return Math.abs(rawWatts) / 1000;
}

async function getDepartsPrincipauxCourante() {
  const departs = await getDepartsDefinitions();
  if (!departs.length) {
    return { capteurs: [] };
  }

  const allTables = departs.flatMap((depart) => depart.parts.map((part) => part.table));
  const valuesByTable = await getLatestTotalPrealByTable(allTables);
  const tranche = detectTrancheByDate(new Date());

  const capteurs = departs.map((depart) => {
    const kw = computeDepartKw(depart, valuesByTable);
    return {
      code: depart.code,
      nom: depart.nom || depart.code,
      pmc_kw: kw ?? 0,
      puissance_souscrite: getSubscribedByTranche(depart, tranche),
    };
  });

  return { capteurs };
}

// Taille de bucket adaptee a l'amplitude demandee, pour eviter de renvoyer des
// dizaines de milliers de points (page/graphe bloques) sur une grande periode.
const ALLOWED_BUCKET_MINUTES = [1, 5, 15, 60, 180];

function computeBucketMinutes(debutDate, finDate) {
  const rangeMinutes = Math.max(1, (finDate.getTime() - debutDate.getTime()) / 60000);
  if (rangeMinutes <= 60) return 1;
  if (rangeMinutes <= 60 * 12) return 5;
  if (rangeMinutes <= 60 * 24 * 3) return 15;
  if (rangeMinutes <= 60 * 24 * 10) return 60;
  return 180;
}

async function getBucketsByTable(tables, debutSql, finSql, bucketMinutes) {
  const validTables = [...new Set(tables)].filter(isValidSqlIdentifier);
  if (!validTables.length) {
    return {};
  }

  const safeBucketMinutes = ALLOWED_BUCKET_MINUTES.includes(bucketMinutes) ? bucketMinutes : 1;
  const bucketExpr =
    safeBucketMinutes <= 1
      ? "DATEADD(minute, DATEDIFF(minute, 0, [date]), 0)"
      : `DATEADD(minute, (DATEDIFF(minute, 0, [date]) / ${safeBucketMinutes}) * ${safeBucketMinutes}, 0)`;

  const pool = await getSourcePool();
  const unionQuery = validTables.map(
    (table) => `SELECT '${table}' AS table_name,
                       CONVERT(varchar(16), ${bucketExpr}, 120) AS minute_bucket,
                       AVG(Total_Preal) AS avg_val
                FROM [dbo].[${table}]
                WHERE [date] >= @debut AND [date] <= @fin AND Total_Preal IS NOT NULL
                GROUP BY ${bucketExpr}`
  ).join(" UNION ALL ");

  const result = await pool
    .request()
    .input("debut", sql.DateTime, new Date(debutSql.replace(" ", "T")))
    .input("fin", sql.DateTime, new Date(finSql.replace(" ", "T")))
    .query(unionQuery);

  const byTable = {};
  for (const row of result.recordset) {
    if (!byTable[row.table_name]) {
      byTable[row.table_name] = new Map();
    }
    byTable[row.table_name].set(row.minute_bucket, Number(row.avg_val || 0));
  }
  return byTable;
}

// Reconstitue, pour chaque bucket de la plage demandee, la valeur de chaque depart
// en lisant directement les tables source SQL Server (meme logique que la card
// "Puissance appelee par depart", generalisee a une plage de dates).
async function getDepartsEvolutionSeries(debut, fin) {
  const departs = await getDepartsDefinitions();
  if (!departs.length) {
    return { series: [], departs: [] };
  }

  const debutDate = new Date(String(debut).replace(" ", "T"));
  const finDate = new Date(String(fin).replace(" ", "T"));
  const debutSql = toSqlDateTime(debutDate);
  const finSql = toSqlDateTime(finDate);
  const bucketMinutes = computeBucketMinutes(debutDate, finDate);

  const allTables = departs.flatMap((depart) => depart.parts.map((part) => part.table));
  const bucketsByTable = await getBucketsByTable(allTables, debutSql, finSql, bucketMinutes);

  const allBuckets = new Set();
  for (const table of new Set(allTables)) {
    const map = bucketsByTable[table];
    if (map) {
      for (const bucket of map.keys()) {
        allBuckets.add(bucket);
      }
    }
  }
  const sortedBuckets = [...allBuckets].sort();

  const series = [];
  for (const bucket of sortedBuckets) {
    for (const depart of departs) {
      const valuesByTable = {};
      let hasAll = true;

      for (const part of depart.parts) {
        const value = bucketsByTable[part.table]?.get(bucket);
        if (value === undefined) {
          hasAll = false;
          break;
        }
        valuesByTable[part.table] = { total_preal: value };
      }

      if (!hasAll) continue;

      const kw = computeDepartKw(depart, valuesByTable);
      series.push({ date: bucket, code: depart.code, kw });
    }
  }

  return { series, departs };
}

async function getDepartsEvolutionParCapteur(debut, fin) {
  const { series } = await getDepartsEvolutionSeries(debut, fin);
  return series.map((item) => ({
    date: item.date,
    capteur_code: item.code,
    pmc_kw: item.kw,
  }));
}

async function getDepartsEvolutionGlobale(debut, fin) {
  const { series, departs } = await getDepartsEvolutionSeries(debut, fin);

  const kwByBucket = new Map();
  for (const item of series) {
    kwByBucket.set(item.date, (kwByBucket.get(item.date) || 0) + item.kw);
  }

  const seuilByTranche = {};

  return [...kwByBucket.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, pmcKw]) => {
      const tranche = detectTrancheByDate(bucket.replace(" ", "T"));
      if (!seuilByTranche[tranche]) {
        seuilByTranche[tranche] = departs.reduce((sum, depart) => sum + getSubscribedByTranche(depart, tranche), 0);
      }
      const seuil = seuilByTranche[tranche];

      return {
        date: bucket,
        pmc_kw: pmcKw,
        pa_i_kw: pmcKw,
        pourcentage: seuil ? (pmcKw / seuil) * 100 : 0,
        tranche_horaire: tranche,
      };
    });
}

async function getDepartsEvolutionCurrentWindow() {
  const fin = new Date();
  const debut = new Date(fin.getTime() - 10 * 60 * 1000);
  return getDepartsEvolutionGlobale(toSqlDateTime(debut), toSqlDateTime(fin));
}

async function getDepartsEvolutionParCapteurCurrentWindow() {
  const fin = new Date();
  const debut = new Date(fin.getTime() - 10 * 60 * 1000);
  return getDepartsEvolutionParCapteur(toSqlDateTime(debut), toSqlDateTime(fin));
}

module.exports = {
  getDepartsDefinitions,
  getLatestTotalPrealByTable,
  computeDepartKw,
  getDepartsPrincipauxCourante,
  getDepartsEvolutionGlobale,
  getDepartsEvolutionParCapteur,
  getDepartsEvolutionCurrentWindow,
  getDepartsEvolutionParCapteurCurrentWindow,
};
