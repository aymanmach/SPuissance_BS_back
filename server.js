const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");

const apiRoutes = require("./routes");
const db = require("./config/db");
const { buildSessionMiddleware } = require("./config/session");
const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");
const { initWebSocket } = require("./websocket/realtime");
const { initSync, stopSync, getSyncStatus } = require("./services/syncService");

dotenv.config();

const app = express();
const server = http.createServer(app);

const sessionMiddleware = buildSessionMiddleware();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    now: new Date().toISOString(),
    sync_enabled: String(process.env.SYNC_ENABLED || "false") === "true",
    sync_status: getSyncStatus(),
  });
});

app.use("/api", apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

initWebSocket(server, sessionMiddleware);

async function start() {
  try {
    await db.query("SELECT 1");

    await initSync();

    const port = Number(process.env.PORT || 5000);
    server.listen(port, () => {
      console.log(`Serveur backend actif sur le port ${port}`);
    });
  } catch (error) {
    console.error("Echec demarrage serveur:", error.message);
    process.exit(1);
  }
}

start();

async function shutdown() {
  try {
    await stopSync();
  } catch (error) {
    console.error("Erreur arret sync:", error.message);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
