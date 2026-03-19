const VIRTUAL_START_RAW = process.env.VIRTUAL_START_DATE || "2026-01-01 01:00:00";
const VIRTUAL_END_RAW = process.env.VIRTUAL_END_DATE || "2026-03-12 13:37:00";
const SPEED_FACTOR = Math.max(1, Number(process.env.VIRTUAL_SPEED_FACTOR || 1));

const parsedStart = parseDateOrThrow(VIRTUAL_START_RAW, "VIRTUAL_START_DATE");
const parsedEnd = parseDateOrThrow(VIRTUAL_END_RAW, "VIRTUAL_END_DATE");

if (parsedEnd <= parsedStart) {
  throw new Error("VIRTUAL_END_DATE doit etre strictement superieure a VIRTUAL_START_DATE");
}

const SERVER_BOOT_EPOCH_MS = Date.now();
const RANGE_MS = parsedEnd.getTime() - parsedStart.getTime();
const TEN_MINUTES_MS = 10 * 60 * 1000;

function getVirtualNow() {
  const elapsedMs = Math.max(0, Date.now() - SERVER_BOOT_EPOCH_MS);
  const virtualElapsedMs = elapsedMs * SPEED_FACTOR;
  const offsetMs = virtualElapsedMs % (RANGE_MS + 1000);
  return new Date(parsedStart.getTime() + offsetMs);
}

function getCurrentTenMinuteWindow(now = getVirtualNow()) {
  const sinceStartMs = Math.max(0, now.getTime() - parsedStart.getTime());
  const bucketOffsetMs = Math.floor(sinceStartMs / TEN_MINUTES_MS) * TEN_MINUTES_MS;
  const windowStart = new Date(parsedStart.getTime() + bucketOffsetMs);
  const windowEnd = now;

  const elapsedWindowSeconds = Math.floor((windowEnd.getTime() - windowStart.getTime()) / 1000);
  const minuteCourante = Math.min(10, Math.max(1, Math.floor(elapsedWindowSeconds / 60) + 1));
  const secondeCourante = Math.max(0, elapsedWindowSeconds % 60);

  return {
    windowStart,
    windowEnd,
    minuteCourante,
    secondeCourante,
  };
}

function getVirtualClockPayload(now = getVirtualNow()) {
  const window = getCurrentTenMinuteWindow(now);
  return {
    virtual_now: toSqlDateTime(now),
    virtual_start: toSqlDateTime(parsedStart),
    virtual_end: toSqlDateTime(parsedEnd),
    window_start: toSqlDateTime(window.windowStart),
    window_end: toSqlDateTime(window.windowEnd),
    minute_courante: window.minuteCourante,
    seconde_courante: window.secondeCourante,
    speed_factor: SPEED_FACTOR,
  };
}

function toSqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseDateOrThrow(value, name) {
  const normalized = String(value || "").trim().replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Date invalide pour ${name}: ${value}`);
  }
  return parsed;
}

module.exports = {
  getVirtualNow,
  getCurrentTenMinuteWindow,
  getVirtualClockPayload,
  toSqlDateTime,
};
