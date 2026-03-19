const db = require("../config/db");

const DAILY_ERROR_THRESHOLD_KW = Number(process.env.DAILY_ERROR_THRESHOLD_KW || 30000);
const DAILY_LOG_SOURCE = "SENSOR_DAILY_MONITOR";

let lastEvaluationMinuteKey = "";

function formatDayBounds(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");

  return {
    dayLabel: `${yyyy}-${mm}-${dd}`,
    dayStart: `${yyyy}-${mm}-${dd} 00:00:00`,
    dayEnd: `${yyyy}-${mm}-${dd} 23:59:59`,
    minuteKey: `${yyyy}-${mm}-${dd} ${hh}:${mi}`,
  };
}

async function ensureDailySensorErrorLogs(virtualNow) {
  const bounds = formatDayBounds(virtualNow);
  if (!bounds) {
    return;
  }

  // Evaluate at most once per virtual minute to avoid unnecessary DB scans.
  if (lastEvaluationMinuteKey === bounds.minuteKey) {
    return;
  }
  lastEvaluationMinuteKey = bounds.minuteKey;

  const { dayLabel, dayStart, dayEnd } = bounds;

  const [overThresholdRows] = await db.query(
    `SELECT c.id AS capteur_id,
            c.code,
            MAX(m.pa_i) AS max_pa_i
     FROM capteurs c
     JOIN mesures m ON m.capteur_id = c.id
     WHERE c.actif = TRUE
       AND m.date BETWEEN ? AND ?
       AND m.pa_i > ?
     GROUP BY c.id, c.code`,
    [dayStart, dayEnd, DAILY_ERROR_THRESHOLD_KW]
  );

  for (const row of overThresholdRows) {
    const capteurId = Number(row.capteur_id);
    const capteurCode = row.code;
    const maxPai = Number(row.max_pa_i || 0);
    const message = `[${dayLabel}] Capteur ${capteurCode}: depassement detecte (${maxPai.toFixed(2)} kW > ${DAILY_ERROR_THRESHOLD_KW} kW).`;

    await db.query(
      `INSERT INTO logs_systeme (date, niveau, source, message, metadata)
       SELECT ?, 'ERROR', ?, ?, JSON_OBJECT('type', 'PAI_OVER_30000', 'date', ?, 'capteur_id', ?, 'capteur_code', ?)
       WHERE NOT EXISTS (
         SELECT 1
         FROM logs_systeme
         WHERE source = ?
           AND date BETWEEN ? AND ?
           AND message = ?
       )`,
      [
        dayEnd,
        DAILY_LOG_SOURCE,
        message,
        dayLabel,
        capteurId,
        capteurCode,
        DAILY_LOG_SOURCE,
        dayStart,
        dayEnd,
        message,
      ]
    );
  }

  const [allNullRows] = await db.query(
    `SELECT c.id AS capteur_id,
            c.code,
            COUNT(m.id) AS total_points,
            SUM(CASE WHEN m.pa_i IS NULL THEN 1 ELSE 0 END) AS null_points
     FROM capteurs c
     LEFT JOIN mesures m
       ON m.capteur_id = c.id
      AND m.date BETWEEN ? AND ?
     WHERE c.actif = TRUE
     GROUP BY c.id, c.code
     HAVING COUNT(m.id) > 0
        AND COUNT(m.id) = SUM(CASE WHEN m.pa_i IS NULL THEN 1 ELSE 0 END)`,
    [dayStart, dayEnd]
  );

  for (const row of allNullRows) {
    const capteurId = Number(row.capteur_id);
    const capteurCode = row.code;
    const points = Number(row.total_points || 0);
    const message = `[${dayLabel}] Capteur ${capteurCode}: toutes les mesures du jour sont NULL (${points} points).`;

    await db.query(
      `INSERT INTO logs_systeme (date, niveau, source, message, metadata)
       SELECT ?, 'ERROR', ?, ?, JSON_OBJECT('type', 'PAI_ALWAYS_NULL', 'date', ?, 'capteur_id', ?, 'capteur_code', ?)
       WHERE NOT EXISTS (
         SELECT 1
         FROM logs_systeme
         WHERE source = ?
           AND date BETWEEN ? AND ?
           AND message = ?
       )`,
      [
        dayEnd,
        DAILY_LOG_SOURCE,
        message,
        dayLabel,
        capteurId,
        capteurCode,
        DAILY_LOG_SOURCE,
        dayStart,
        dayEnd,
        message,
      ]
    );
  }
}

module.exports = {
  ensureDailySensorErrorLogs,
};
