const sql = require("mssql");
require("dotenv").config();

const config = {
  server: process.env.SOURCE_DB_HOST || "127.0.0.1",
  port: Number(process.env.SOURCE_DB_PORT || 1433),
  user: process.env.SOURCE_DB_USER || "spuissance",
  password: process.env.SOURCE_DB_PASSWORD || "",
  database: process.env.SOURCE_DB_NAME || "basetest",
  options: {
    encrypt: process.env.SOURCE_DB_ENCRYPT === "true",
    trustServerCertificate: process.env.SOURCE_DB_TRUST_CERT !== "false",
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

const instanceName = String(process.env.SOURCE_DB_INSTANCE || "").trim();
if (instanceName) {
  config.options.instanceName = instanceName;
} else {
  config.options.port = Number(process.env.SOURCE_DB_PORT || 1433);
}

const connectTimeout = Number(process.env.SOURCE_DB_CONNECT_TIMEOUT || 30000);
const requestTimeout = Number(process.env.SOURCE_DB_REQUEST_TIMEOUT || 30000);
if (Number.isFinite(connectTimeout) && connectTimeout > 0) {
  config.connectionTimeout = connectTimeout;
}
if (Number.isFinite(requestTimeout) && requestTimeout > 0) {
  config.requestTimeout = requestTimeout;
}

let pool = null;

async function getSourcePool() {
  if (pool) {
    return pool;
  }

  pool = await sql.connect(config);
  // console.log("Connexion SQL Server etablie");
  return pool;
}

async function closeSourcePool() {
  if (!pool) {
    return;
  }

  await pool.close();
  pool = null;
}

module.exports = {
  getSourcePool,
  closeSourcePool,
  sql,
};
