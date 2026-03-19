const { Server } = require("socket.io");
const db = require("../config/db");
const { ROLES } = require("../config/constants");
const { socketRequireAuth } = require("../middlewares/auth");
const { wrapExpressMiddleware } = require("../config/session");
const { getPaiCouranteGlobale, getPmcCouranteGlobale } = require("../services/powerMetricsService");
const { verifierEtEnregistrerDepassementAutomatique } = require("../services/depassementService");
const { ensureDailySensorErrorLogs } = require("../services/logsSystemeService");

const CACHE_MS = Math.max(500, Number(process.env.DASHBOARD_CACHE_MS || 1000));
const PUSH_INTERVAL_MS = Math.max(500, Number(process.env.DASHBOARD_PUSH_INTERVAL_MS || 1000));

let payloadCache = null;
let payloadCacheAt = 0;
let payloadInFlight = null;
let globalTickerStarted = false;

async function getOrBuildPayload() {
  const now = Date.now();

  if (payloadCache && now - payloadCacheAt < CACHE_MS) {
    return payloadCache;
  }

  if (payloadInFlight) {
    return payloadInFlight;
  }

  payloadInFlight = buildDashboardPayload()
    .then((payload) => {
      payloadCache = payload;
      payloadCacheAt = Date.now();
      return payload;
    })
    .finally(() => {
      payloadInFlight = null;
    });

  return payloadInFlight;
}

function emitAlertIfNeeded(io, payload) {
  const pai = Number(payload?.pai?.valeur || 0);
  const ps = Number(payload?.pai?.ps || 0);

  if (!ps) {
    return;
  }

  if (pai >= ps) {
    io.emit("alerte", {
      niveau: "ERROR",
      message: `Depassement detecte: +${(pai - ps).toFixed(2)} kW`,
    });
    return;
  }

  if (pai >= ps * 0.95) {
    io.emit("alerte", {
      niveau: "WARNING",
      message: `Seuil proche: ${Number(payload?.pai?.pourcentage || 0).toFixed(2)}% de la puissance souscrite`,
    });
  }
}

function startGlobalTicker(io) {
  if (globalTickerStarted) {
    return;
  }

  globalTickerStarted = true;

  setInterval(async () => {
    try {
      const payload = await getOrBuildPayload();
      io.emit("dashboard_update", payload);
      io.to("admins").emit("dashboard_admin_update", payload);
      emitAlertIfNeeded(io, payload);
    } catch (error) {
      console.error("WebSocket global tick error:", error.message);
    }
  }, PUSH_INTERVAL_MS);
}

function initWebSocket(server, sessionMiddleware) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true,
    },
  });

  io.use(wrapExpressMiddleware(sessionMiddleware));
  io.use(socketRequireAuth);

  startGlobalTicker(io);

  io.on("connection", (socket) => {
    const user = socket.user;

    socket.join(`user-${user.id}`);
    if (user.role === ROLES.ADMIN) {
      socket.join("admins");
    }

    getOrBuildPayload()
      .then((payload) => {
        socket.emit("dashboard_update", payload);
        if (user.role === ROLES.ADMIN) {
          socket.emit("dashboard_admin_update", payload);
        }
      })
      .catch((error) => {
        socket.emit("error", { message: error.message });
      });

    socket.on("disconnect", () => {});
  });

  return io;
}

async function buildDashboardPayload() {
  const [pai, pmc] = await Promise.all([getPaiCouranteGlobale(), getPmcCouranteGlobale()]);

  try {
    await verifierEtEnregistrerDepassementAutomatique(pmc);
  } catch (error) {
    console.error("Auto depassement save error:", error.message);
  }

  await ensureDailySensorErrorLogs(pmc.virtual_now || pai.date);

  const [logs] = await db.query(
    `SELECT id, date, niveau, source, message
     FROM logs_systeme
     ORDER BY date DESC
     LIMIT 10`
  );

  return {
    pai: {
      valeur: Number(pai.pa_i || 0),
      date: pai.date,
      tranche: pai.tranche_horaire,
      ps: Number(pai.puissance_souscrite || 0),
      pourcentage: Number(pai.pourcentage || 0),
      capteurs: pai.capteurs || [],
    },
    pmc: {
      valeur: Number(pmc.pmc_kw || 0),
      pourcentage: Number(pmc.pourcentage || 0),
      ps: Number(pmc.puissance_souscrite || 0),
      minute_courante: pmc.minute_courante,
      seconde_courante: pmc.seconde_courante,
      capteurs: pmc.capteurs || [],
    },
    virtual_clock: {
      virtual_now: pmc.virtual_now,
      window_start: pmc.window_start,
      window_end: pmc.window_end,
      minute_courante: pmc.minute_courante,
      seconde_courante: pmc.seconde_courante,
    },
    logs,
    ts: pmc.virtual_now || pai.date,
  };
}

module.exports = {
  initWebSocket,
};
