const DEFAULT_SUBSCRIBED_POWER = 11000;

const TRANCHE_WINDOWS = [
  { type: "HC", startHour: 22, endHour: 6 },
  { type: "HPO", startHour: 17, endHour: 22 },
  { type: "HP", startHour: 6, endHour: 17 },
];

const ROLES = {
  ADMIN: "admin",
  SUPERVISEUR_LAC: "superviseur_lac",
    SUPERVISEUR_LAF: "superviseur_laf",
  SUPERVISEUR_ACIERIE: "superviseur_acierie",
  SUPERVISEUR_ENERGIE: "superviseur_energie",
  USER: "user",
};

module.exports = {
  DEFAULT_SUBSCRIBED_POWER,
  TRANCHE_WINDOWS,
  ROLES,
};
