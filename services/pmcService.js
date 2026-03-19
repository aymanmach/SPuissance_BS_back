const db = require("../config/db");
const { DEFAULT_SUBSCRIBED_POWER } = require("../config/constants");

async function getCurrentPmc(capteurCode = "MC02") {
  const [[lastMeasure]] = await db.query(
    `SELECT m.date, m.pa_i, m.tranche_horaire, c.id AS capteur_id,
            COALESCE(c.puissance_souscrite_hc, ?) AS puissance_souscrite_hc,
            COALESCE(c.puissance_souscrite_hp, ?) AS puissance_souscrite_hp,
            COALESCE(c.puissance_souscrite_hpo, ?) AS puissance_souscrite_hpo
     FROM mesures m
     JOIN capteurs c ON c.id = m.capteur_id
     WHERE c.code = ?
     ORDER BY m.date DESC
     LIMIT 1`,
    [DEFAULT_SUBSCRIBED_POWER, DEFAULT_SUBSCRIBED_POWER, DEFAULT_SUBSCRIBED_POWER, capteurCode]
  );

  if (!lastMeasure) {
    return null;
  }

  const [[windowStats]] = await db.query(
    `SELECT AVG(pa_i) AS pmc_kw, COUNT(*) AS points
     FROM mesures
     WHERE capteur_id = ?
       AND date >= DATE_SUB(?, INTERVAL 10 MINUTE)
       AND date <= ?`,
    [lastMeasure.capteur_id, lastMeasure.date, lastMeasure.date]
  );

  const subscribedPower = getSubscribedPower(lastMeasure.tranche_horaire, lastMeasure);
  const pmcKw = Number(windowStats?.pmc_kw || 0);

  return {
    date: lastMeasure.date,
    minute_courante: Math.min(Number(windowStats?.points || 0), 10),
    pmc_kw: pmcKw,
    pa_i_kw: Number(lastMeasure.pa_i || 0),
    puissance_souscrite: subscribedPower,
    pourcentage: subscribedPower ? (pmcKw / subscribedPower) * 100 : 0,
    tranche_horaire: lastMeasure.tranche_horaire,
  };
}

async function getPmcEvolution(capteurCode = "MC02", limit = 120) {
  const [rows] = await db.query(
    `SELECT p.date, p.pmc_kw, p.pa_i_kw, p.pourcentage, p.tranche_horaire
     FROM pmc_glissante p
     JOIN capteurs c ON c.id = p.capteur_id
     WHERE c.code = ?
     ORDER BY p.date DESC
     LIMIT ?`,
    [capteurCode, Number(limit)]
  );

  return rows.reverse();
}

function getSubscribedPower(tranche, capteur) {
  if (tranche === "HC") return Number(capteur.puissance_souscrite_hc || DEFAULT_SUBSCRIBED_POWER);
  if (tranche === "HPO") return Number(capteur.puissance_souscrite_hpo || DEFAULT_SUBSCRIBED_POWER);
  return Number(capteur.puissance_souscrite_hp || DEFAULT_SUBSCRIBED_POWER);
}

module.exports = {
  getCurrentPmc,
  getPmcEvolution,
};
