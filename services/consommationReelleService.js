const { getSourcePool } = require("../config/sourceDb");

const PROCEDURE_NAME = "dbo.PCons_réelle_T10DX";

async function getPconsReelleCourante() {
  const pool = await getSourcePool();
  const result = await pool.request().execute(PROCEDURE_NAME);
  const rows = (result.recordset || [])
    .map((row) => ({
      date: new Date(row.DA),
      pa: Number(row.PA),
      pc: Number(row.PC),
    }))
    .filter((row) => !Number.isNaN(row.date.getTime()) && !Number.isNaN(row.pa))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!rows.length) {
    return null;
  }

  const windowStart = rows[0].date;
  const last = rows[rows.length - 1];

  const paiKw = last.pa;
  const seuilKw = last.pc;
  const pmcKw = rows.reduce((sum, row) => sum + row.pa, 0) / rows.length;

  const elapsedSeconds = Math.max(0, Math.min(599, Math.round((last.date.getTime() - windowStart.getTime()) / 1000)));
  const minuteCourante = Math.min(10, Math.max(1, Math.floor(elapsedSeconds / 60) + 1));
  const secondeCourante = elapsedSeconds % 60;

  return {
    date: last.date.toISOString(),
    pai_kw: paiKw,
    pmc_kw: pmcKw,
    puissance_souscrite: seuilKw,
    minute_courante: minuteCourante,
    seconde_courante: secondeCourante,
    points_fenetre: rows.length,
  };
}

module.exports = {
  getPconsReelleCourante,
};
