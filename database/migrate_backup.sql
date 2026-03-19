
USE basetest;

USE basetest;
  ADD COLUMN IF NOT EXISTS table_source VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS frequence_secondes INT NOT NULL DEFAULT 60;

ALTER TABLE mesures
  ADD COLUMN IF NOT EXISTS source_table VARCHAR(100) NULL;

-- ---------------------------------------------------------------------------
-- 2) Seed/maj des 10 capteurs phase 2
-- ---------------------------------------------------------------------------
INSERT INTO capteurs
  (code, nom, table_source, frequence_secondes,
   puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo, actif)
VALUES
  ('A127_MC02', 'Capteur A127', 'A127_MC02',  1, 11000, 11000, 11000, TRUE),
  ('A137_MC02', 'Capteur A137', 'A137_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A138_MC02', 'Capteur A138', 'A138_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A139_MC02', 'Capteur A139', 'A139_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A144_MC02', 'Capteur A144', 'A144_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A145_MC02', 'Capteur A145', 'A145_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A146_MC02', 'Capteur A146', 'A146_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A147_MC02', 'Capteur A147', 'A147_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A148_MC02', 'Capteur A148', 'A148_MC02', 60, 11000, 11000, 11000, TRUE),
  ('A150_MC02', 'Capteur A150', 'A150_MC02', 60, 11000, 11000, 11000, TRUE)
ON DUPLICATE KEY UPDATE
  nom = VALUES(nom),
  table_source = VALUES(table_source),
  frequence_secondes = VALUES(frequence_secondes),
  puissance_souscrite_hc = VALUES(puissance_souscrite_hc),
  puissance_souscrite_hp = VALUES(puissance_souscrite_hp),
  puissance_souscrite_hpo = VALUES(puissance_souscrite_hpo),
  actif = VALUES(actif);

-- ---------------------------------------------------------------------------
-- 3) Migration mesure par mesure (anti-duplication via LEFT JOIN)
--    Tranches: HC = [22h-06h[, HP = [06h-17h[, HPO = [17h-22h[
-- ---------------------------------------------------------------------------

-- 1. A127_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END AS tranche_horaire,
  'A127_MC02'
FROM basetest.A127_MC02 s
JOIN capteurs c ON c.code = 'A127_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A137_MC02'
FROM basetest.A137_MC02 s
JOIN capteurs c ON c.code = 'A137_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 3. A138_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A138_MC02'
FROM basetest.A138_MC02 s
JOIN capteurs c ON c.code = 'A138_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 4. A139_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A139_MC02'
FROM basetest.A139_MC02 s
JOIN capteurs c ON c.code = 'A139_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 5. A144_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A144_MC02'
FROM basetest.A144_MC02 s
JOIN capteurs c ON c.code = 'A144_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 6. A145_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A145_MC02'
FROM basetest.A145_MC02 s
JOIN capteurs c ON c.code = 'A145_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 7. A146_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A146_MC02'
FROM basetest.A146_MC02 s
JOIN capteurs c ON c.code = 'A146_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 8. A147_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A147_MC02'
FROM basetest.A147_MC02 s
JOIN capteurs c ON c.code = 'A147_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 9. A148_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A148_MC02'
FROM basetest.A148_MC02 s
JOIN capteurs c ON c.code = 'A148_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- 10. A150_MC02
INSERT INTO mesures (capteur_id, date, pa_i, tranche_horaire, source_table)
SELECT
  c.id,
  s.date,
  s.PA_I,
  CASE
    WHEN HOUR(s.date) >= 22 OR HOUR(s.date) < 6 THEN 'HC'
    WHEN HOUR(s.date) >= 17 THEN 'HPO'
    ELSE 'HP'
  END,
  'A150_MC02'
FROM basetest.A150_MC02 s
JOIN capteurs c ON c.code = 'A150_MC02'
LEFT JOIN mesures m ON m.capteur_id = c.id AND m.date = s.date
WHERE m.id IS NULL
ORDER BY s.date ASC;

-- ---------------------------------------------------------------------------
-- 4) Rapport de verification global
-- ---------------------------------------------------------------------------
SELECT
  c.code AS capteur,
  c.frequence_secondes AS freq_sec,
  COUNT(m.id) AS total_mesures,
  MIN(m.date) AS premiere_mesure,
  MAX(m.date) AS derniere_mesure,
  ROUND(AVG(m.pa_i), 2) AS moy_pa_i_kw,
  ROUND(MAX(m.pa_i), 2) AS max_pa_i_kw,
  COUNT(CASE WHEN m.tranche_horaire = 'HC'  THEN 1 END) AS nb_hc,
  COUNT(CASE WHEN m.tranche_horaire = 'HP'  THEN 1 END) AS nb_hp,
  COUNT(CASE WHEN m.tranche_horaire = 'HPO' THEN 1 END) AS nb_hpo
FROM capteurs c
LEFT JOIN mesures m ON m.capteur_id = c.id
WHERE c.code IN (
  'A127_MC02','A137_MC02','A138_MC02','A139_MC02','A144_MC02',
  'A145_MC02','A146_MC02','A147_MC02','A148_MC02','A150_MC02'
)
GROUP BY c.id, c.code, c.frequence_secondes
ORDER BY c.id;
