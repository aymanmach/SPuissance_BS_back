USE basetest;

START TRANSACTION;

INSERT IGNORE INTO roles (code, libelle)
VALUES ('superviseur', 'Superviseur');

INSERT INTO utilisateurs (
  matricule,
  nom,
  telephone,
  mail,
  login,
  mot_de_passe_hash,
  role_id,
  actif
)
SELECT
  '9195',
  'Superviseur Principal',
  '+33 6 55 66 77 88',
  'superviseur@energie.fr',
  'superviseur',
  '$2a$10$ufnylAkwY.vuqmwiWROQr.xrc5f4Rk6d7eaF3JbveCdnJaXp2SZL6',
  r.id,
  TRUE
FROM roles r
WHERE r.code = 'superviseur'
  AND NOT EXISTS (
    SELECT 1 FROM utilisateurs u WHERE u.login = 'superviseur'
  );

UPDATE utilisateurs u
JOIN roles r ON r.code = 'superviseur'
SET
  u.role_id = r.id,
  u.actif = TRUE
WHERE u.login = 'superviseur';

INSERT IGNORE INTO utilisateur_usines (utilisateur_id, usine_id)
SELECT u.id, us.id
FROM utilisateurs u
JOIN usines us ON us.code IN ('LAC', 'ACIERIE', 'LAF')
WHERE u.login = 'superviseur';

COMMIT;
