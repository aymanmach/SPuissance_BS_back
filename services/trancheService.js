const { TRANCHE_WINDOWS } = require("../config/constants");

function detectTrancheByDate(dateValue) {
  const date = new Date(dateValue);
  const hour = date.getHours();

  for (const tranche of TRANCHE_WINDOWS) {
    if (tranche.startHour > tranche.endHour) {
      if (hour >= tranche.startHour || hour < tranche.endHour) {
        return tranche.type;
      }
      continue;
    }

    if (hour >= tranche.startHour && hour < tranche.endHour) {
      return tranche.type;
    }
  }

  return "HP";
}

module.exports = {
  detectTrancheByDate,
};
