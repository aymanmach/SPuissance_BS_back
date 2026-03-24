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

// Ticker de detection independant : toujours 1 seconde, pas lie au cache
const DETECTION_INTERVAL_MS = 1000;

const DEPASSEMENT_DUREE_MIN_MS = 10 * 60 * 1000; // 10 minutes en millisecondes

let payloadCache = null;
let payloadCacheAt = 0;
let payloadInFlight = null;
let globalTickerStarted = false;

// --- Etat de la fenetre glissante de depassement ---
// Stocke le debut du depassement continu et la pmc max observee
let depassementEnCours = null;
// Structure : { debut: Date, maxPmcKw: Number, capteurs: Array }

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

/**
 * Gere la logique de fenetre glissante :
 * - Si pmc >= seuil : on demarre ou on continue le chrono
 * - Si 10 min continues ecoulees : on enregistre et on reset
 * - Si pmc < seuil : on annule le chrono en cours
 */
async function gererFenetreGlissanteDepassement(pmc) {
  const pmcKw = Number(pmc?.pmc_kw || 0);
  const seuilKw = Number(pmc?.puissance_souscrite || 0);

  if (!seuilKw) return;

  const virtualNow = pmc?.virtual_now;
  if (!virtualNow) return;

  const now = new Date(String(virtualNow).replace(" ", "T"));
  if (Number.isNaN(now.getTime())) return;

  // Tolerance : on ignore les micro-baisses jusqu'a 95% du seuil
  // En dessous de 95% seulement on considere que le depassement est termine
  const seuilAnnulation = seuilKw * 0.95;

  if (pmcKw >= seuilKw) {
    if (!depassementEnCours) {
      // Premiere seconde du depassement : on demarre le chrono
      depassementEnCours = {
        debut: now,
        maxPmcKw: pmcKw,
        capteurs: pmc.capteurs || [],
      };
      console.log(`[DEPASSEMENT] Debut detecte a ${now.toISOString()} | pmc=${pmcKw} kW | seuil=${seuilKw} kW`);
    } else {
      // Depassement continu : on met a jour le max et les capteurs
      if (pmcKw > depassementEnCours.maxPmcKw) {
        depassementEnCours.maxPmcKw = pmcKw;
        depassementEnCours.capteurs = pmc.capteurs || [];
      }

      const dureeMs = now.getTime() - depassementEnCours.debut.getTime();

      if (dureeMs >= DEPASSEMENT_DUREE_MIN_MS) {
        // 10 minutes continues atteintes : on enregistre
        console.log(`[DEPASSEMENT] 10 min continues atteintes. Enregistrement... debut=${depassementEnCours.debut.toISOString()}`);

        try {
          const pmcPourEnregistrement = {
            ...pmc,
            pmc_kw: depassementEnCours.maxPmcKw,
            capteurs: depassementEnCours.capteurs,
          };
          await verifierEtEnregistrerDepassementAutomatique(pmcPourEnregistrement, depassementEnCours.debut);
        } catch (error) {
          console.error("[DEPASSEMENT] Erreur enregistrement automatique:", error.message);
        }

        // Reset : on repart a zero (un nouveau depassement peut commencer immediatement)
        depassementEnCours = null;
      }
    }
  } else if (pmcKw < seuilAnnulation) {
    // pmc est descendu sous 95% du seuil : annulation reelle du chrono
    if (depassementEnCours) {
      const dureeMs = now.getTime() - depassementEnCours.debut.getTime();
      console.log(`[DEPASSEMENT] Annulation (pmc=${pmcKw.toFixed(1)} kW < 95% seuil=${seuilAnnulation.toFixed(1)} kW | duree: ${Math.round(dureeMs / 1000)}s)`);
      depassementEnCours = null;
    }
  }
  // Si seuilAnnulation <= pmc < seuilKw : fluctuation toleree, le chrono continue
}

function startGlobalTicker(io) {
  if (globalTickerStarted) {
    return;
  }

  globalTickerStarted = true;

  // --- Ticker 1 : detection du depassement (toutes les secondes, JAMAIS mis en cache) ---
  setInterval(async () => {
    try {
      const pmc = await getPmcCouranteGlobale();
      await gererFenetreGlissanteDepassement(pmc);
    } catch (error) {
      console.error("[DEPASSEMENT] Erreur ticker detection:", error.message);
    }
  }, DETECTION_INTERVAL_MS);

  // --- Ticker 2 : push dashboard vers les clients (utilise le cache) ---
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
    // Expose l'etat du depassement en cours pour le frontend si besoin
    depassement_en_cours: depassementEnCours
      ? {
          debut: depassementEnCours.debut.toISOString(),
          duree_secondes: Math.round((Date.now() - depassementEnCours.debut.getTime()) / 1000),
          max_pmc_kw: depassementEnCours.maxPmcKw,
        }
      : null,
    logs,
    ts: pmc.virtual_now || pai.date,
  };
}

module.exports = {
  initWebSocket,
};