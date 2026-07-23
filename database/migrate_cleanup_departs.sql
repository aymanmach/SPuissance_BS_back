USE basetest;

-- ---------------------------------------------------------------------------
-- 1) Purge complete de l'historique des depassements et des logs (toutes usines)
--    pour repartir sur une base coherente avec la nouvelle logique "departs"
-- ---------------------------------------------------------------------------
DELETE FROM depassement_capteurs;
DELETE FROM depassements;
DELETE FROM logs_systeme;

ALTER TABLE depassement_capteurs AUTO_INCREMENT = 1;
ALTER TABLE depassements AUTO_INCREMENT = 1;
ALTER TABLE logs_systeme AUTO_INCREMENT = 1;

-- ---------------------------------------------------------------------------
-- 2) Suppression definitive des 8 anciens capteurs bruts LAF, remplaces par
--    les 7 departs principaux (PKB, LGA, LGB, LGP, CRMA, CRMB, COMPRESSEUR)
-- ---------------------------------------------------------------------------
DELETE FROM mesures WHERE capteur_id IN (
  SELECT id FROM (
    SELECT id FROM capteurs WHERE code IN ('A12','A15','A18','A21','A120','A127','A128','A135')
  ) AS old_capteurs
);

DELETE FROM pmc_glissante WHERE capteur_id IN (
  SELECT id FROM (
    SELECT id FROM capteurs WHERE code IN ('A12','A15','A18','A21','A120','A127','A128','A135')
  ) AS old_capteurs
);

DELETE FROM capteurs WHERE code IN ('A12','A15','A18','A21','A120','A127','A128','A135');
