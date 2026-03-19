const sql = require("mssql");
require("dotenv").config();

async function run() {
  const options = {
    encrypt: process.env.SOURCE_DB_ENCRYPT === "true",
    trustServerCertificate: process.env.SOURCE_DB_TRUST_CERT !== "false",
  };

  const instance = String(process.env.SOURCE_DB_INSTANCE || "").trim();
  if (instance) {
    options.instanceName = instance;
  }

  const config = {
    server: process.env.SOURCE_DB_HOST,
    port: Number(process.env.SOURCE_DB_PORT || 1433),
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    database: process.env.SOURCE_DB_NAME,
    options,
    connectionTimeout: Number(process.env.SOURCE_DB_CONNECT_TIMEOUT || 30000),
    requestTimeout: Number(process.env.SOURCE_DB_REQUEST_TIMEOUT || 30000),
  };

  const schema = process.env.SOURCE_DB_SCHEMA || "dbo";
  const tables = ["A127_MC02", "A137_MC02", "A138_MC02", "A139_MC02", "A144_MC02", "A145_MC02", "A146_MC02", "A147_MC02", "A148_MC02", "A150_MC02"];

  const pool = await sql.connect(config);
  try {
    const projected = new Date("2026-01-01T14:07:46");
    for (const table of tables) {
      const q = `SELECT COUNT(1) AS n, MIN([date]) AS dmin, MAX([date]) AS dmax FROM [${schema}].[${table}]`;
      const result = await pool.request().query(q);
      console.log(table, result.recordset[0]);

      const replayCheck = await pool
        .request()
        .input("projected", sql.DateTime, projected)
        .query(
          `SELECT TOP 1 [date], [PA_I]
           FROM [${schema}].[${table}]
           WHERE [date] <= @projected
             AND [PA_I] IS NOT NULL
             AND [PA_I] > 0
           ORDER BY [date] DESC`
        );
      console.log(`${table} replay_check`, replayCheck.recordset[0] || null);
    }
  } finally {
    await pool.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
