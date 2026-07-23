require("dotenv").config();
const db = require("./config/db");
const { getPmcMaxParTranche } = require("./services/depassementService");

async function main() {
  const fin = new Date();
  const debut = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 0, 0, 0);

  console.log("=== Mon calcul actuel (getPmcMaxParTranche) ===");
  const rows = await getPmcMaxParTranche(debut.toISOString(), fin.toISOString(), ["LAF"]);
  console.log(JSON.stringify(rows, null, 2));

  console.log("\n=== Verite terrain: somme par minute (tous departs) ===");
  const [sumRows] = await db.query(
    `SELECT DATE_FORMAT(m.date, '%Y-%m-%d %H:%i:00') AS minute_bucket,
            SUM(m.pa_i) AS total_kw,
            COUNT(DISTINCT m.capteur_id) AS nb_departs,
            GROUP_CONCAT(c.code ORDER BY c.code) AS departs_presents
     FROM mesures m
     JOIN capteurs c ON c.id = m.capteur_id
     WHERE c.actif = TRUE
       AND m.date BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(m.date, '%Y-%m-%d %H:%i:00')
     ORDER BY total_kw DESC
     LIMIT 10`,
    [debut, fin]
  );
  console.log(JSON.stringify(sumRows, null, 2));

  console.log("\n=== Max individuel par depart sur la journee ===");
  const [maxByDepart] = await db.query(
    `SELECT c.code, MAX(m.pa_i) AS max_kw, MIN(m.date) as premiere, MAX(m.date) as derniere, COUNT(*) as nb
     FROM mesures m
     JOIN capteurs c ON c.id = m.capteur_id
     WHERE c.actif = TRUE
       AND m.date BETWEEN ? AND ?
     GROUP BY c.code
     ORDER BY c.code`,
    [debut, fin]
  );
  console.log(JSON.stringify(maxByDepart, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERREUR FULL:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
  process.exit(1);
});
