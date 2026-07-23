USE basetest;

-- ---------------------------------------------------------------------------
-- 1) Structure: un capteur peut desormais etre calcule a partir de plusieurs
--    tables source SQL Server combinees par + ou - (ex: LGA = A128 - A15 - A16 - A17 - A18)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capteur_sous_departs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  table_source VARCHAR(50) NOT NULL,
  operation ENUM('+','-') NOT NULL DEFAULT '+',
  ordre TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sous_depart_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_capteur_ordre (capteur_id, ordre),
  INDEX idx_sous_depart_capteur (capteur_id)
);

-- ---------------------------------------------------------------------------
-- 2) Creation des 7 departs principaux (usine LAF)
-- ---------------------------------------------------------------------------
INSERT INTO capteurs
  (code, nom, frequence_secondes, usine_id, type, description,
   puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo, actif)
VALUES
  ('PKB', 'PKB', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal PKB = ABS(A20 - A21)', 11000, 11000, 11000, TRUE),
  ('LGA', 'LGA', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal LGA = ABS(A128 - A15 - A16 - A17 - A18)', 11000, 11000, 11000, TRUE),
  ('LGB', 'LGB', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal LGB = A18', 11000, 11000, 11000, TRUE),
  ('LGP', 'LGP', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal LGP = A15 + A16', 11000, 11000, 11000, TRUE),
  ('CRMA', 'CRMA', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal CRMA = A12 + A13', 11000, 11000, 11000, TRUE),
  ('CRMB', 'CRMB', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal CRMB = A120 + A121', 11000, 11000, 11000, TRUE),
  ('COMPRESSEUR', 'COMPRESSEUR', 60, (SELECT id FROM usines WHERE code = 'LAF'), 'depart',
   'Depart principal COMPRESSEUR = A4 + A8 + A19', 11000, 11000, 11000, TRUE)
ON DUPLICATE KEY UPDATE
  nom = VALUES(nom),
  usine_id = VALUES(usine_id),
  type = VALUES(type),
  description = VALUES(description),
  actif = VALUES(actif);

-- ---------------------------------------------------------------------------
-- 3) Formules (sous-departs) de chaque depart principal
-- ---------------------------------------------------------------------------
DELETE sd FROM capteur_sous_departs sd
JOIN capteurs c ON c.id = sd.capteur_id
WHERE c.code IN ('PKB','LGA','LGB','LGP','CRMA','CRMB','COMPRESSEUR');

INSERT INTO capteur_sous_departs (capteur_id, table_source, operation, ordre)
SELECT id, 'A20', '+', 1 FROM capteurs WHERE code = 'PKB'
UNION ALL SELECT id, 'A21', '-', 2 FROM capteurs WHERE code = 'PKB'
UNION ALL SELECT id, 'A128', '+', 1 FROM capteurs WHERE code = 'LGA'
UNION ALL SELECT id, 'A15', '-', 2 FROM capteurs WHERE code = 'LGA'
UNION ALL SELECT id, 'A16', '-', 3 FROM capteurs WHERE code = 'LGA'
UNION ALL SELECT id, 'A17', '-', 4 FROM capteurs WHERE code = 'LGA'
UNION ALL SELECT id, 'A18', '-', 5 FROM capteurs WHERE code = 'LGA'
UNION ALL SELECT id, 'A18', '+', 1 FROM capteurs WHERE code = 'LGB'
UNION ALL SELECT id, 'A15', '+', 1 FROM capteurs WHERE code = 'LGP'
UNION ALL SELECT id, 'A16', '+', 2 FROM capteurs WHERE code = 'LGP'
UNION ALL SELECT id, 'A12', '+', 1 FROM capteurs WHERE code = 'CRMA'
UNION ALL SELECT id, 'A13', '+', 2 FROM capteurs WHERE code = 'CRMA'
UNION ALL SELECT id, 'A120', '+', 1 FROM capteurs WHERE code = 'CRMB'
UNION ALL SELECT id, 'A121', '+', 2 FROM capteurs WHERE code = 'CRMB'
UNION ALL SELECT id, 'A4', '+', 1 FROM capteurs WHERE code = 'COMPRESSEUR'
UNION ALL SELECT id, 'A8', '+', 2 FROM capteurs WHERE code = 'COMPRESSEUR'
UNION ALL SELECT id, 'A19', '+', 3 FROM capteurs WHERE code = 'COMPRESSEUR';

-- ---------------------------------------------------------------------------
-- 4) Desactivation des anciens capteurs bruts LAF remplaces par les departs
--    (donnees historiques conservees, juste retires du sync/des courbes)
-- ---------------------------------------------------------------------------
UPDATE capteurs
SET actif = FALSE
WHERE code IN ('A12','A15','A18','A21','A120','A127','A128','A135')
  AND usine_id = (SELECT id FROM usines WHERE code = 'LAF');
