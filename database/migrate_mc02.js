const mysql = require("mysql2/promise");
const mssql = require("mssql");
const dotenv = require("dotenv");
const { execSync } = require("child_process");

const { detectTrancheByDate } = require("../services/trancheService");

dotenv.config();

const DEFAULT_SOURCE_TABLES = [
  "A127_MC02",
  "A137_MC02",
  "A138_MC02",
  "A139_MC02",
  "A144_MC02",
  "A145_MC02",
  "A146_MC02",
  "A147_MC02",
  "A148_MC02",
  "A150_MC02",
];

async function migrate() {
  const sourceEngine = (process.env.SOURCE_DB_ENGINE || "mssql").toLowerCase();
  const targetDbName = process.env.DB_NAME || "basetest";
  const sourceTables = getSourceTablesFromEnv();
  const sourceSchema = process.env.SOURCE_DB_SCHEMA || "dbo";
  const useRange = String(process.env.MIGRATION_USE_RANGE || "false") === "true";
  const rangeStart = process.env.MIGRATION_START_DATE || null;
  const rangeEnd = process.env.MIGRATION_END_DATE || null;
  const shouldPurge = String(process.env.MIGRATION_PURGE_TARGET || "false") === "true";
  const batchSize = Number(process.env.MIGRATION_BATCH_SIZE || 5000);

  let sourceMysql = null;
  let sourceMssql = null;
  let target = null;

  try {
    await ensureTargetDatabaseExists(targetDbName);

    target = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: targetDbName,
      connectionLimit: 5,
    });

    // Limite plus haute pour reduire les faux positifs de timeout sur de gros imports.
    await target.query(`SET SESSION innodb_lock_wait_timeout = ?`, [Number(process.env.DB_LOCK_WAIT_TIMEOUT || 180)]);

    const [tables] = await target.query(
      `SELECT COUNT(*) AS count_tables
       FROM information_schema.tables
       WHERE table_schema = ?
         AND table_name IN ('capteurs', 'mesures')`,
      [targetDbName]
    );
    if (Number(tables[0]?.count_tables || 0) < 2) {
      throw new Error("Tables cibles manquantes. Execute d'abord: mysql -u root -p < database/schema.sql");
    }

    const mesuresHasSourceTable = await tableHasColumn(target, targetDbName, "mesures", "source_table");

    if (useRange) {
      if (!rangeStart || !rangeEnd) {
        throw new Error("MIGRATION_USE_RANGE=true mais MIGRATION_START_DATE / MIGRATION_END_DATE manquantes");
      }
      console.log(`Mode migration: plage ${rangeStart} -> ${rangeEnd}`);
    } else {
      console.log("Mode migration: TOUTES les donnees source");
    }

    console.log(`Capteurs source a migrer: ${sourceTables.join(", ")}`);

    if (sourceEngine === "mssql") {
      sourceMssql = await connectMssqlWithFallback();
    } else {
      sourceMysql = mysql.createPool({
        host: process.env.SOURCE_DB_HOST || "localhost",
        port: Number(process.env.SOURCE_DB_PORT || 3306),
        user: process.env.SOURCE_DB_USER || "root",
        password: process.env.SOURCE_DB_PASSWORD || "",
        database: process.env.SOURCE_DB_NAME,
        connectionLimit: 5,
      });
    }

    const migrationSummary = [];

    for (const sourceTable of sourceTables) {
      try {
        assertSafeIdentifier(sourceTable, "SOURCE_DB_TABLES");
        assertSafeIdentifier(sourceSchema, "SOURCE_DB_SCHEMA");

        const capteur = await ensureCapteurForSource(target, sourceTable);
        console.log(`\n[${sourceTable}] Debut migration | capteur_id=${capteur.id}`);

        if (shouldPurge) {
          console.log(`[${sourceTable}] Purge cible activee...`);
          await purgeTargetMesuresInChunks({
            target,
            capteurId: capteur.id,
            useRange,
            rangeStart,
            rangeEnd,
          });
        }

        let scannedRows = 0;
        let insertedRows = 0;

        if (sourceEngine === "mssql") {
          const streamResult = await migrateSourceTableWithMssqlStream({
            sourceMssql,
            target,
            sourceSchema,
            sourceTable,
            capteurId: capteur.id,
            useRange,
            rangeStart,
            rangeEnd,
            batchSize,
            mesuresHasSourceTable,
          });
          scannedRows = streamResult.scannedRows;
          insertedRows = streamResult.insertedRows;
        } else {
          let offset = 0;
          while (true) {
            const rows = await fetchSourceBatch({
              sourceEngine,
              sourceSchema,
              sourceTable,
              useRange,
              rangeStart,
              rangeEnd,
              sourceMssql,
              sourceMysql,
              batchSize,
              offset,
            });

            if (rows.length === 0) {
              break;
            }

            const batch = mesuresHasSourceTable
              ? rows.map((row) => [
                  capteur.id,
                  row.date,
                  Number(row.PA_I || 0),
                  detectTrancheByDate(row.date),
                  sourceTable,
                ])
              : rows.map((row) => [
                  capteur.id,
                  row.date,
                  Number(row.PA_I || 0),
                  detectTrancheByDate(row.date),
                ]);

            const [insertResult] = await executeWithRetry(
              () =>
                target.query(
                  mesuresHasSourceTable
                    ? `INSERT IGNORE INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table) VALUES ?`
                    : `INSERT IGNORE INTO mesures (capteur_id, date, pa_i, tranche_horaire) VALUES ?`,
                  [batch]
                ),
              {
                label: `insert mesures ${sourceTable}`,
                maxRetries: Number(process.env.MIGRATION_RETRIES || 8),
                retryDelayMs: Number(process.env.MIGRATION_RETRY_DELAY_MS || 1200),
              }
            );

            scannedRows += rows.length;
            insertedRows += Number(insertResult?.affectedRows || 0);
            offset += rows.length;

            process.stdout.write(`\r[${sourceTable}] Lignes traitees: ${scannedRows} | inserees: ${insertedRows}`);
          }
        }

        const ignoredDuplicates = scannedRows - insertedRows;
        console.log(`\n[${sourceTable}] Termine. Scannees=${scannedRows}, inserees=${insertedRows}, ignorees(doublons)=${ignoredDuplicates}`);

        migrationSummary.push({
          sourceTable,
          capteurCode: capteur.code,
          sourceRows: scannedRows,
          insertedRows,
          ignoredDuplicates,
          status: "OK",
        });
      } catch (error) {
        console.warn(`\n[${sourceTable}] Ignore: ${error.message}`);
        migrationSummary.push({
          sourceTable,
          capteurCode: "N/A",
          sourceRows: 0,
          insertedRows: 0,
          ignoredDuplicates: 0,
          status: `ERREUR: ${error.message}`,
        });
      }
    }

    const totalInserted = migrationSummary.reduce((sum, item) => sum + item.insertedRows, 0);
    const totalScanned = migrationSummary.reduce((sum, item) => sum + item.sourceRows, 0);

    console.log("\n==================== RESUME MIGRATION ====================");
    for (const item of migrationSummary) {
      console.log(
        `${item.sourceTable} -> code=${item.capteurCode} | source=${item.sourceRows} | inserees=${item.insertedRows} | doublons=${item.ignoredDuplicates} | ${item.status}`
      );
    }
    console.log(`TOTAL source=${totalScanned} | TOTAL inserees=${totalInserted}`);
    console.log("Migration terminee avec succes.");
  } finally {
    if (sourceMysql) {
      await sourceMysql.end();
    }
    if (sourceMssql) {
      await sourceMssql.close();
    }
    if (target) {
      await target.end();
    }
  }
}

function getSourceTablesFromEnv() {
  const raw = process.env.SOURCE_DB_TABLES;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return DEFAULT_SOURCE_TABLES;
}

function assertSafeIdentifier(identifier, envName) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Valeur invalide pour ${envName}: ${identifier}`);
  }
}

async function tableHasColumn(target, dbName, tableName, columnName) {
  const [[row]] = await target.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [dbName, tableName, columnName]
  );

  return Number(row?.c || 0) > 0;
}

async function ensureCapteurForSource(target, sourceTable) {
  const [[existingByCode]] = await target.query(
    `SELECT id, code FROM capteurs WHERE code = ? LIMIT 1`,
    [sourceTable]
  );
  if (existingByCode) {
    return existingByCode;
  }

  // Compatibilite ascendante: certains environnements utilisent MC02 pour A127_MC02.
  if (sourceTable === "A127_MC02") {
    const [[legacyMc02]] = await target.query(
      `SELECT id, code FROM capteurs WHERE code = 'MC02' LIMIT 1`
    );
    if (legacyMc02) {
      return legacyMc02;
    }
  }

  await target.query(
    `INSERT INTO capteurs (code, nom, frequence_secondes, actif)
     VALUES (?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE nom = VALUES(nom), frequence_secondes = VALUES(frequence_secondes), actif = TRUE`,
    [sourceTable, `Capteur ${sourceTable}`, getFrequenceSecondesBySourceTable(sourceTable)]
  );

  const [[created]] = await target.query(
    `SELECT id, code FROM capteurs WHERE code = ? LIMIT 1`,
    [sourceTable]
  );

  if (!created) {
    throw new Error(`Impossible de creer ou recuperer le capteur cible pour ${sourceTable}`);
  }

  return created;
}

function getFrequenceSecondesBySourceTable(sourceTable) {
  return sourceTable === "A127_MC02" ? 1 : 60;
}

async function countSourceRows({
  sourceEngine,
  sourceSchema,
  sourceTable,
  useRange,
  rangeStart,
  rangeEnd,
  sourceMssql,
  sourceMysql,
}) {
  if (sourceEngine === "mssql") {
    const request = sourceMssql.request();

    if (useRange) {
      request.input("rangeStart", mssql.DateTime2, new Date(rangeStart));
      request.input("rangeEnd", mssql.DateTime2, new Date(rangeEnd));
      const result = await request.query(
        `SELECT COUNT(1) AS total
         FROM [${sourceSchema}].[${sourceTable}]
         WHERE [date] BETWEEN @rangeStart AND @rangeEnd`
      );
      return Number(result.recordset?.[0]?.total || 0);
    }

    const result = await request.query(
      `SELECT COUNT(1) AS total
       FROM [${sourceSchema}].[${sourceTable}]`
    );
    return Number(result.recordset?.[0]?.total || 0);
  }

  if (useRange) {
    const [rows] = await sourceMysql.query(
      `SELECT COUNT(1) AS total FROM \`${sourceTable}\` WHERE date BETWEEN ? AND ?`,
      [rangeStart, rangeEnd]
    );
    return Number(rows?.[0]?.total || 0);
  }

  const [rows] = await sourceMysql.query(`SELECT COUNT(1) AS total FROM \`${sourceTable}\``);
  return Number(rows?.[0]?.total || 0);
}

async function migrateSourceTableWithMssqlStream({
  sourceMssql,
  target,
  sourceSchema,
  sourceTable,
  capteurId,
  useRange,
  rangeStart,
  rangeEnd,
  batchSize,
  mesuresHasSourceTable,
}) {
  const insertSql = mesuresHasSourceTable
    ? `INSERT IGNORE INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table) VALUES ?`
    : `INSERT IGNORE INTO mesures (capteur_id, date, pa_i, tranche_horaire) VALUES ?`;

  return new Promise((resolve, reject) => {
    const request = new mssql.Request(sourceMssql);
    request.stream = true;

    let scannedRows = 0;
    let insertedRows = 0;
    let batch = [];
    let settled = false;
    let flushChain = Promise.resolve();

    const flushBatch = async () => {
      if (batch.length === 0) {
        return;
      }

      const toInsert = batch;
      batch = [];

      const payload = mesuresHasSourceTable
        ? toInsert.map((row) => [
            capteurId,
            row.date,
            Number(row.PA_I || 0),
            detectTrancheByDate(row.date),
            sourceTable,
          ])
        : toInsert.map((row) => [
            capteurId,
            row.date,
            Number(row.PA_I || 0),
            detectTrancheByDate(row.date),
          ]);

      const [insertResult] = await executeWithRetry(
        () => target.query(insertSql, [payload]),
        {
          label: `insert stream mesures ${sourceTable}`,
          maxRetries: Number(process.env.MIGRATION_RETRIES || 8),
          retryDelayMs: Number(process.env.MIGRATION_RETRY_DELAY_MS || 1200),
        }
      );

      scannedRows += payload.length;
      insertedRows += Number(insertResult?.affectedRows || 0);
      process.stdout.write(`\r[${sourceTable}] Lignes traitees: ${scannedRows} | inserees: ${insertedRows}`);
    };

    const settleReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const settleResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    request.on("row", (row) => {
      batch.push(row);
      if (batch.length >= batchSize) {
        request.pause();
        flushChain = flushChain
          .then(async () => {
            await flushBatch();
            request.resume();
          })
          .catch((error) => {
            settleReject(error);
          });
      }
    });

    request.on("error", (error) => {
      settleReject(error);
    });

    request.on("done", () => {
      flushChain
        .then(async () => {
          await flushBatch();
          settleResolve({ scannedRows, insertedRows });
        })
        .catch((error) => {
          settleReject(error);
        });
    });

    if (useRange) {
      request.input("rangeStart", mssql.DateTime2, new Date(rangeStart));
      request.input("rangeEnd", mssql.DateTime2, new Date(rangeEnd));
      request.query(
        `SELECT [date], [PA_I]
         FROM [${sourceSchema}].[${sourceTable}]
         WHERE [date] BETWEEN @rangeStart AND @rangeEnd
         ORDER BY [date] ASC`
      );
      return;
    }

    request.query(
      `SELECT [date], [PA_I]
       FROM [${sourceSchema}].[${sourceTable}]
       ORDER BY [date] ASC`
    );
  });
}

async function fetchSourceBatch({
  sourceEngine,
  sourceSchema,
  sourceTable,
  useRange,
  rangeStart,
  rangeEnd,
  sourceMssql,
  sourceMysql,
  batchSize,
  offset,
}) {
  if (sourceEngine === "mssql") {
    const request = sourceMssql.request();
    request.input("offset", mssql.Int, Number(offset));
    request.input("batchSize", mssql.Int, Number(batchSize));

    if (useRange) {
      request.input("rangeStart", mssql.DateTime2, new Date(rangeStart));
      request.input("rangeEnd", mssql.DateTime2, new Date(rangeEnd));
      const result = await request.query(
        `SELECT [date], [PA_I]
         FROM [${sourceSchema}].[${sourceTable}]
         WHERE [date] BETWEEN @rangeStart AND @rangeEnd
         ORDER BY [date] ASC
         OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY`
      );
      return result.recordset || [];
    }

    const result = await request.query(
      `SELECT [date], [PA_I]
       FROM [${sourceSchema}].[${sourceTable}]
       ORDER BY [date] ASC
       OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY`
    );
    return result.recordset || [];
  }

  if (useRange) {
    const [rows] = await sourceMysql.query(
      `SELECT date, PA_I
       FROM \`${sourceTable}\`
       WHERE date BETWEEN ? AND ?
       ORDER BY date ASC
       LIMIT ? OFFSET ?`,
      [rangeStart, rangeEnd, Number(batchSize), Number(offset)]
    );
    return rows || [];
  }

  const [rows] = await sourceMysql.query(
    `SELECT date, PA_I
     FROM \`${sourceTable}\`
     ORDER BY date ASC
     LIMIT ? OFFSET ?`,
    [Number(batchSize), Number(offset)]
  );
  return rows || [];
}

async function executeWithRetry(fn, { label, maxRetries = 5, retryDelayMs = 1000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const mysqlCode = Number(error?.errno || 0);
      const isRetryable = mysqlCode === 1205 || mysqlCode === 1213;

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const wait = retryDelayMs * (attempt + 1);
      console.warn(
        `\n${label || "operation"} temporairement bloquee (errno ${mysqlCode}). Retry ${attempt + 1}/${maxRetries} dans ${wait}ms...`
      );
      await sleep(wait);
    }
  }
}

async function purgeTargetMesuresInChunks({
  target,
  capteurId,
  useRange,
  rangeStart,
  rangeEnd,
}) {
  const deleteChunkSize = Number(process.env.MIGRATION_DELETE_CHUNK || 10000);
  let deletedTotal = 0;

  while (true) {
    const query = useRange
      ? `DELETE FROM mesures
         WHERE capteur_id = ?
           AND date BETWEEN ? AND ?
         LIMIT ${deleteChunkSize}`
      : `DELETE FROM mesures
         WHERE capteur_id = ?
         LIMIT ${deleteChunkSize}`;

    const params = useRange ? [capteurId, rangeStart, rangeEnd] : [capteurId];

    const [result] = await executeWithRetry(
      () => target.query(query, params),
      {
        label: "delete mesures chunk",
        maxRetries: Number(process.env.MIGRATION_RETRIES || 8),
        retryDelayMs: Number(process.env.MIGRATION_RETRY_DELAY_MS || 1200),
      }
    );

    const affected = Number(result?.affectedRows || 0);
    deletedTotal += affected;
    if (affected === 0) {
      break;
    }

    process.stdout.write(`\rLignes purgees: ${deletedTotal}`);
  }

  console.log(`\nPurge terminee. Total purge: ${deletedTotal}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMssqlConnectionConfig() {
  const rawHost = process.env.SOURCE_DB_HOST || "localhost";
  const [serverPart, inlineInstance] = rawHost.split("\\");
  const instanceName = process.env.SOURCE_DB_INSTANCE || inlineInstance;

  const baseConfig = {
    server: serverPart,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    database: process.env.SOURCE_DB_NAME,
    connectionTimeout: Number(process.env.SOURCE_DB_CONNECT_TIMEOUT || 30000),
    requestTimeout: Number(process.env.SOURCE_DB_REQUEST_TIMEOUT || 30000),
    options: {
      encrypt: String(process.env.SOURCE_DB_ENCRYPT || "false") === "true",
      trustServerCertificate: String(process.env.SOURCE_DB_TRUST_CERT || "true") === "true",
    },
  };

  if (instanceName) {
    baseConfig.options.instanceName = instanceName;
  } else {
    baseConfig.port = Number(process.env.SOURCE_DB_PORT || 1433);
  }

  return baseConfig;
}

function buildMssqlConnectionCandidates() {
  const rawHost = process.env.SOURCE_DB_HOST || "localhost";
  const [serverPart, inlineInstance] = rawHost.split("\\");
  const instanceName = process.env.SOURCE_DB_INSTANCE || inlineInstance;
  const explicitPort = Number(process.env.SOURCE_DB_PORT || 1433);
  const discoveredPorts = instanceName ? discoverSqlServerInstancePorts(instanceName) : [];

  const baseByInstance = buildMssqlConnectionConfig();
  const candidates = [];

  if (instanceName) {
    candidates.push({
      label: `${serverPart}\\${instanceName}`,
      config: baseByInstance,
    });

    if (serverPart.toLowerCase() !== "localhost") {
      candidates.push({
        label: `localhost\\${instanceName}`,
        config: {
          ...baseByInstance,
          server: "localhost",
        },
      });
    }

    candidates.push({
      label: `${serverPart}:${explicitPort}`,
      config: (() => {
        const config = {
        ...baseByInstance,
        server: serverPart,
        port: explicitPort,
          options: {
            ...baseByInstance.options,
          },
        };
        delete config.options.instanceName;
        return config;
      })(),
    });

    for (const discoveredPort of discoveredPorts) {
      candidates.push({
        label: `${serverPart}:${discoveredPort} (registry)`,
        config: (() => {
          const config = {
            ...baseByInstance,
            server: serverPart,
            port: discoveredPort,
            options: {
              ...baseByInstance.options,
            },
          };
          delete config.options.instanceName;
          return config;
        })(),
      });

      if (serverPart.toLowerCase() !== "localhost") {
        candidates.push({
          label: `localhost:${discoveredPort} (registry)`,
          config: (() => {
            const config = {
              ...baseByInstance,
              server: "localhost",
              port: discoveredPort,
              options: {
                ...baseByInstance.options,
              },
            };
            delete config.options.instanceName;
            return config;
          })(),
        });
      }
    }
  } else {
    candidates.push({
      label: `${serverPart}:${explicitPort}`,
      config: {
        ...baseByInstance,
        port: explicitPort,
      },
    });
  }

  return candidates;
}

function discoverSqlServerInstancePorts(instanceName) {
  if (process.platform !== "win32") {
    return [];
  }

  const registryRoots = [
    "HKLM\\SOFTWARE\\Microsoft\\Microsoft SQL Server",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Microsoft SQL Server",
  ];

  for (const root of registryRoots) {
    const instanceId = readRegistryValue(`${root}\\Instance Names\\SQL`, instanceName);
    if (!instanceId) {
      continue;
    }

    const tcpPath = `${root}\\${instanceId}\\MSSQLServer\\SuperSocketNetLib\\Tcp\\IPAll`;
    const staticPort = readRegistryValue(tcpPath, "TcpPort");
    const dynamicPortsRaw = readRegistryValue(tcpPath, "TcpDynamicPorts");

    const discovered = [staticPort, dynamicPortsRaw]
      .flatMap((raw) => (raw || "").split(","))
      .map((value) => Number(String(value).trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (discovered.length > 0) {
      return [...new Set(discovered)];
    }
  }

  return [];
}

function readRegistryValue(path, valueName) {
  try {
    const output = execSync(`reg query "${path}" /v ${valueName}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const matchingLine = lines.find((line) => line.toLowerCase().startsWith(valueName.toLowerCase()));
    if (!matchingLine) {
      return null;
    }

    const parts = matchingLine.split(/\s+/);
    return parts.slice(2).join(" ").trim() || null;
  } catch {
    return null;
  }
}

async function connectMssqlWithFallback() {
  const candidates = buildMssqlConnectionCandidates();
  const errors = [];

  for (const candidate of candidates) {
    try {
      console.log(`Tentative connexion SQL Server source: ${candidate.label}`);
      return await mssql.connect(candidate.config);
    } catch (error) {
      errors.push(`${candidate.label} -> ${error.message}`);
    }
  }

  throw new Error(
    [
      "Impossible de se connecter a SQL Server source.",
      ...errors,
      "Conseil: pour SQLEXPRESS, active TCP/IP dans SQL Server Configuration Manager puis fixe un port (ex: 1433) et renseigne SOURCE_DB_PORT.",
    ].join("\n")
  );
}

async function ensureTargetDatabaseExists(dbName) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error("Migration en echec:", error.message);
  process.exit(1);
});
