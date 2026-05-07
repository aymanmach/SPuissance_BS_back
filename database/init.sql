-- ============================================================
--  init.sql — Migration unique et complète
--  Projet  : Surveillance Puissance Appelée (SPuissance)
--  Usage   : mysql -u root -p < serveur/database/init.sql
--  Idempotent : peut être relancé sans perte de données
-- ============================================================
--  Comptes par défaut créés :
--    admin            / admin123
--    superviseur      / superviseur123
--    superviseur_lac  / lac123
--    superviseur_laf  / laf123
--    superviseur_acierie / acierie123
--    superviseur_energie / energie123
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- ÉTAPE 1 : Base de données
-- ============================================================
CREATE DATABASE IF NOT EXISTS basetest
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE basetest;

-- ============================================================
-- ÉTAPE 2 : Tables (ordre FK strict)
-- ============================================================

-- 1) usines
CREATE TABLE IF NOT EXISTS usines (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  code        VARCHAR(20)  NOT NULL UNIQUE,
  nom         VARCHAR(120) NOT NULL,
  localisation VARCHAR(180) NULL,
  actif       BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2) roles
CREATE TABLE IF NOT EXISTS roles (
  id         SMALLINT     PRIMARY KEY AUTO_INCREMENT,
  code       VARCHAR(50)  NOT NULL UNIQUE,
  libelle    VARCHAR(120) NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- 3) utilisateurs → roles
CREATE TABLE IF NOT EXISTS utilisateurs (
  id                INT          PRIMARY KEY AUTO_INCREMENT,
  matricule         VARCHAR(50)  NOT NULL UNIQUE,
  nom               VARCHAR(120) NOT NULL,
  telephone         VARCHAR(30)  NULL,
  mail              VARCHAR(150) NOT NULL UNIQUE,
  login             VARCHAR(80)  NOT NULL UNIQUE,
  mot_de_passe_hash VARCHAR(255) NOT NULL,
  role_id           SMALLINT     NOT NULL,
  actif             BOOLEAN      DEFAULT TRUE,
  dernier_login_at  DATETIME     NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_utilisateur_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 4) utilisateur_usines → utilisateurs, usines
CREATE TABLE IF NOT EXISTS utilisateur_usines (
  utilisateur_id INT NOT NULL,
  usine_id       INT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (utilisateur_id, usine_id),
  CONSTRAINT fk_uu_user  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  CONSTRAINT fk_uu_usine FOREIGN KEY (usine_id)       REFERENCES usines(id)       ON DELETE CASCADE
);

-- 5) sessions_utilisateurs → utilisateurs
CREATE TABLE IF NOT EXISTS sessions_utilisateurs (
  id             BIGINT       PRIMARY KEY AUTO_INCREMENT,
  session_id     VARCHAR(191) NOT NULL UNIQUE,
  utilisateur_id INT          NOT NULL,
  ip_address     VARCHAR(64)  NULL,
  user_agent     VARCHAR(255) NULL,
  expires_at     DATETIME     NOT NULL,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  INDEX idx_sessions_expires (expires_at)
);

-- 6) capteurs → usines
CREATE TABLE IF NOT EXISTS capteurs (
  id                    INT           PRIMARY KEY AUTO_INCREMENT,
  code                  VARCHAR(50)   NOT NULL UNIQUE,
  nom                   VARCHAR(120)  NOT NULL,
  table_source          VARCHAR(100)  NULL,
  frequence_secondes    INT           NOT NULL DEFAULT 60,
  usine_id              INT           NULL,
  type                  VARCHAR(80)   NULL,
  description           TEXT          NULL,
  `precision`           VARCHAR(100)  NULL,
  puissance_souscrite_hc  DECIMAL(12,2) DEFAULT 11000,
  puissance_souscrite_hp  DECIMAL(12,2) DEFAULT 11000,
  puissance_souscrite_hpo DECIMAL(12,2) DEFAULT 11000,
  actif                 BOOLEAN       DEFAULT TRUE,
  installed_at          DATETIME      NULL,
  last_maintenance_at   DATETIME      NULL,
  created_at            TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_capteur_usine FOREIGN KEY (usine_id) REFERENCES usines(id)
);

-- 7) tranches_horaires
CREATE TABLE IF NOT EXISTS tranches_horaires (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  nom          VARCHAR(120)  NOT NULL,
  saison       ENUM('ete','hiver') NOT NULL,
  type_tranche ENUM('HC','HP','HPO') NOT NULL,
  prix_kw      DECIMAL(10,4) NOT NULL,
  heure_debut  TIME          NOT NULL,
  heure_fin    TIME          NOT NULL,
  actif        BOOLEAN       DEFAULT TRUE,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tranche_saison_type_plage (saison, type_tranche, heure_debut, heure_fin)
);

-- 8) mesures → capteurs
CREATE TABLE IF NOT EXISTS mesures (
  id              BIGINT      PRIMARY KEY AUTO_INCREMENT,
  capteur_id      INT         NOT NULL,
  date            DATETIME(3) NOT NULL,
  pa_i            DECIMAL(12,3) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  qualite_mesure  ENUM('OK','ESTIMEE','MANQUANTE') DEFAULT 'OK',
  source_table    VARCHAR(100) NULL,
  source_row_id   VARCHAR(100) NULL,
  created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mesure_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  UNIQUE KEY uq_capteur_date (capteur_id, date),
  INDEX idx_date              (date),
  INDEX idx_capteur_date_mes  (capteur_id, date),
  INDEX idx_tranche_mes       (tranche_horaire, date)
);

-- 9) pmc_glissante → capteurs
CREATE TABLE IF NOT EXISTS pmc_glissante (
  id                  BIGINT        PRIMARY KEY AUTO_INCREMENT,
  capteur_id          INT           NOT NULL,
  date                DATETIME(3)   NOT NULL,
  minute_courante     TINYINT       NOT NULL,
  points_fenetre      TINYINT       NOT NULL DEFAULT 0,
  pmc_kw              DECIMAL(12,3) NOT NULL,
  pa_i_kw             DECIMAL(12,3) NOT NULL,
  puissance_souscrite DECIMAL(12,2) NOT NULL,
  pourcentage         DECIMAL(6,2)  NOT NULL,
  tranche_horaire     ENUM('HC','HP','HPO') NOT NULL,
  created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pmc_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  INDEX idx_pmc_date              (date),
  INDEX idx_pmc_capteur_date      (capteur_id, date)
);

-- 10) depassements → capteurs, usines, utilisateurs
CREATE TABLE IF NOT EXISTS depassements (
  id           BIGINT        PRIMARY KEY AUTO_INCREMENT,
  capteur_id   INT           NOT NULL,
  usine_id     INT           NULL,
  date         DATETIME(3)   NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  pa_i_kw      DECIMAL(12,3) NOT NULL,
  pmc_kw       DECIMAL(12,3) NULL,
  seuil_kw     DECIMAL(12,2) NOT NULL,
  ecart_kw     DECIMAL(12,3) NOT NULL,
  description  TEXT          NULL,
  acquitte     BOOLEAN       DEFAULT FALSE,
  acquitte_par INT           NULL,
  acquitte_at  DATETIME      NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dep_capteur FOREIGN KEY (capteur_id)   REFERENCES capteurs(id),
  CONSTRAINT fk_dep_usine   FOREIGN KEY (usine_id)     REFERENCES usines(id),
  CONSTRAINT fk_dep_user    FOREIGN KEY (acquitte_par) REFERENCES utilisateurs(id),
  INDEX idx_dep_date        (date),
  INDEX idx_dep_tranche     (tranche_horaire, date),
  INDEX idx_dep_acquitte    (acquitte)
);

-- 11) depassement_capteurs → depassements, capteurs
CREATE TABLE IF NOT EXISTS depassement_capteurs (
  id             BIGINT        PRIMARY KEY AUTO_INCREMENT,
  depassement_id BIGINT        NOT NULL,
  capteur_id     INT           NOT NULL,
  valeur_kw      DECIMAL(12,3) NOT NULL,
  seuil_kw       DECIMAL(12,3) NOT NULL,
  created_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_depc_dep     FOREIGN KEY (depassement_id) REFERENCES depassements(id)  ON DELETE CASCADE,
  CONSTRAINT fk_depc_capteur FOREIGN KEY (capteur_id)     REFERENCES capteurs(id)       ON DELETE CASCADE,
  INDEX idx_depc_dep     (depassement_id),
  INDEX idx_depc_capteur (capteur_id)
);

-- 12) alertes_systeme → depassements, capteurs, utilisateurs
CREATE TABLE IF NOT EXISTS alertes_systeme (
  id             BIGINT        PRIMARY KEY AUTO_INCREMENT,
  depassement_id BIGINT        NULL,
  capteur_id     INT           NULL,
  niveau         ENUM('INFO','WARNING','ERROR') NOT NULL,
  message        TEXT          NOT NULL,
  statut         ENUM('NOUVELLE','LUE','TRAITEE') DEFAULT 'NOUVELLE',
  emitted_at     DATETIME(3)   DEFAULT CURRENT_TIMESTAMP(3),
  acquittee_at   DATETIME      NULL,
  acquittee_par  INT           NULL,
  CONSTRAINT fk_alerte_dep    FOREIGN KEY (depassement_id) REFERENCES depassements(id)  ON DELETE SET NULL,
  CONSTRAINT fk_alerte_capteur FOREIGN KEY (capteur_id)   REFERENCES capteurs(id)       ON DELETE SET NULL,
  CONSTRAINT fk_alerte_user   FOREIGN KEY (acquittee_par) REFERENCES utilisateurs(id)   ON DELETE SET NULL,
  INDEX idx_alertes_niveau (niveau, emitted_at),
  INDEX idx_alertes_statut (statut, emitted_at)
);

-- 13) logs_systeme → utilisateurs
CREATE TABLE IF NOT EXISTS logs_systeme (
  id             BIGINT      PRIMARY KEY AUTO_INCREMENT,
  date           DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  niveau         ENUM('INFO','WARNING','ERROR') NOT NULL,
  source         VARCHAR(80) NOT NULL,
  message        TEXT        NOT NULL,
  utilisateur_id INT         NULL,
  request_id     VARCHAR(80) NULL,
  metadata       JSON        NULL,
  CONSTRAINT fk_log_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  INDEX idx_log_date         (date),
  INDEX idx_log_niveau       (niveau),
  INDEX idx_log_source_date  (source, date)
);

-- 14) audit_actions → utilisateurs
CREATE TABLE IF NOT EXISTS audit_actions (
  id             BIGINT       PRIMARY KEY AUTO_INCREMENT,
  utilisateur_id INT          NULL,
  module         VARCHAR(80)  NOT NULL,
  action         VARCHAR(80)  NOT NULL,
  cible_type     VARCHAR(80)  NULL,
  cible_id       VARCHAR(80)  NULL,
  details        JSON         NULL,
  date_action    DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  INDEX idx_audit_date   (date_action),
  INDEX idx_audit_module (module, date_action)
);

-- 15) parametres_systeme → utilisateurs
CREATE TABLE IF NOT EXISTS parametres_systeme (
  cle         VARCHAR(100) PRIMARY KEY,
  valeur      TEXT         NOT NULL,
  type_valeur ENUM('STRING','NUMBER','BOOLEAN','JSON') DEFAULT 'STRING',
  description VARCHAR(255) NULL,
  updated_by  INT          NULL,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_param_user FOREIGN KEY (updated_by) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- 16) seuils_capteurs → capteurs, usines, utilisateurs
CREATE TABLE IF NOT EXISTS seuils_capteurs (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  capteur_id        INT           NOT NULL,
  usine_id          INT           NOT NULL,
  seuil_hc          DECIMAL(12,2) NOT NULL DEFAULT 11000,
  seuil_hp          DECIMAL(12,2) NOT NULL DEFAULT 11000,
  seuil_hpo         DECIMAL(12,2) NOT NULL DEFAULT 11000,
  date_modification DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  modifie_par       INT           NULL,
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_capteur_usine (capteur_id, usine_id),
  CONSTRAINT fk_seuil_capteur FOREIGN KEY (capteur_id)  REFERENCES capteurs(id)      ON DELETE CASCADE,
  CONSTRAINT fk_seuil_usine   FOREIGN KEY (usine_id)    REFERENCES usines(id)        ON DELETE CASCADE,
  CONSTRAINT fk_seuil_user    FOREIGN KEY (modifie_par) REFERENCES utilisateurs(id)  ON DELETE SET NULL,
  INDEX idx_seuil_capteur_id        (capteur_id),
  INDEX idx_seuil_usine_id          (usine_id),
  INDEX idx_seuil_date_modification (date_modification)
);

-- ============================================================
-- ÉTAPE 3 : Données de référence
-- ============================================================

-- 3.1 Usines
INSERT IGNORE INTO usines (id, code, nom, localisation, actif) VALUES
  (1, 'LAC',     'Laminage à Chaud', 'Site principal',   TRUE),
  (2, 'ACIERIE', 'Aciérie',          'Site principal',   TRUE),
  (3, 'LAF',     'Laminage à Froid', 'Site secondaire',  TRUE);

-- 3.2 Rôles (6 rôles)
INSERT IGNORE INTO roles (id, code, libelle) VALUES
  (1, 'admin',               'Administrateur'),
  (2, 'superviseur',         'Superviseur'),
  (3, 'superviseur_lac',     'Superviseur LAC'),
  (4, 'superviseur_laf',     'Superviseur LAF'),
  (5, 'superviseur_acierie', 'Superviseur ACIERIE'),
  (6, 'superviseur_energie', 'Superviseur Énergie');

-- 3.3 Utilisateurs par défaut (6 comptes)
--   Mots de passe hashés bcrypt saltRounds=10
--   admin            → admin123
--   superviseur      → superviseur123
--   superviseur_lac  → lac123
--   superviseur_laf  → laf123
--   superviseur_acierie → acierie123
--   superviseur_energie → energie123
INSERT IGNORE INTO utilisateurs
  (id, matricule, nom, telephone, mail, login, mot_de_passe_hash, role_id, actif)
VALUES
  (1, '9191', 'Admin Système',         '+213 0 00 00 00 01', 'admin@spuissance.local',
      'admin',
      '$2a$10$0uJz3i1sfIqYDJVVZJk8SOBF6v0ldt2cYQZ2eW1mBu8VVbAECIHby', 1, TRUE),

  (2, '9192', 'Superviseur Principal', '+213 0 00 00 00 02', 'superviseur@spuissance.local',
      'superviseur',
      '$2a$10$7sU6hT935ULiVqfaZAg4EeeHZkWppRQYF/9Oq.dC7lP/MRd6taC3O', 2, TRUE),

  (3, '9193', 'Superviseur LAC',       '+213 0 00 00 00 03', 'lac@spuissance.local',
      'superviseur_lac',
      '$2a$10$RjhUczJWH1kmOB9XQI/1quKPmg5qiiWcN/ye7FPqhRFIZHFLYrviG', 3, TRUE),

  (4, '9194', 'Superviseur LAF',       '+213 0 00 00 00 04', 'laf@spuissance.local',
      'superviseur_laf',
      '$2a$10$UlV2U8ML5.6.2j7CRaJu2uhxgT0Z6D.jEmqJJG1.jDFvVlKZMXYUS', 4, TRUE),

  (5, '9195', 'Superviseur ACIÉRIE',   '+213 0 00 00 00 05', 'acierie@spuissance.local',
      'superviseur_acierie',
      '$2a$10$X53oH6CSR7TiN5uaLdY25uJDvBotP4VNKdGNVKQjY6suq/nqVc3mq', 5, TRUE),

  (6, '9196', 'Superviseur Énergie',   '+213 0 00 00 00 06', 'energie@spuissance.local',
      'superviseur_energie',
      '$2a$10$JpLPB/47gWBjpk3SloX.LupBsHPdbmZqw4OyrOM8jkrGfcvEWQGEi', 6, TRUE);

-- 3.4 Accès usines par utilisateur
--   admin            → LAC + ACIERIE + LAF
--   superviseur      → LAC + ACIERIE + LAF
--   superviseur_lac  → LAC uniquement
--   superviseur_laf  → LAF uniquement
--   superviseur_acierie → ACIERIE uniquement
--   superviseur_energie → LAC + ACIERIE + LAF
INSERT IGNORE INTO utilisateur_usines (utilisateur_id, usine_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1), (2, 2), (2, 3),
  (3, 1),
  (4, 3),
  (5, 2),
  (6, 1), (6, 2), (6, 3);

-- 3.5 Tranches horaires (été + hiver)
INSERT IGNORE INTO tranches_horaires
  (nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif)
VALUES
  ('Heures Creuses',   'ete',   'HC',  0.0800, '22:00:00', '07:00:00', TRUE),
  ('Heures Pleines',   'ete',   'HP',  0.1200, '07:00:00', '18:00:00', TRUE),
  ('Heures de Pointe', 'ete',   'HPO', 0.1800, '18:00:00', '22:00:00', TRUE),
  ('Heures Creuses',   'hiver', 'HC',  0.0900, '22:00:00', '06:00:00', TRUE),
  ('Heures Pleines',   'hiver', 'HP',  0.1400, '06:00:00', '17:00:00', TRUE),
  ('Heures de Pointe', 'hiver', 'HPO', 0.2000, '17:00:00', '22:00:00', TRUE);

-- 3.6 Capteurs (8 capteurs actifs LAF — usine_id=3)
--   table_source = nom exact de la table dans SQL Server (dbo.{table_source})
--   Correspond à SOURCE_DB_TABLES dans .env
INSERT INTO capteurs
  (id, code, nom, table_source, frequence_secondes, usine_id, actif,
   puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo)
VALUES
  (1, 'A127', 'Capteur A127', 'A127', 1,  3, TRUE, 11000, 11000, 11000),
  (2, 'A21',  'Capteur A21',  'A21',  60, 3, TRUE, 11000, 11000, 11000),
  (3, 'A12',  'Capteur A12',  'A12',  60, 3, TRUE, 11000, 11000, 11000),
  (4, 'A120', 'Capteur A120', 'A120', 60, 3, TRUE, 11000, 11000, 11000),
  (5, 'A128', 'Capteur A128', 'A128', 60, 3, TRUE, 11000, 11000, 11000),
  (6, 'A18',  'Capteur A18',  'A18',  60, 3, TRUE, 11000, 11000, 11000),
  (7, 'A15',  'Capteur A15',  'A15',  60, 3, TRUE, 11000, 11000, 11000),
  (8, 'A135', 'Capteur A135', 'A135', 60, 3, TRUE, 11000, 11000, 11000)
ON DUPLICATE KEY UPDATE
  nom                     = VALUES(nom),
  table_source            = VALUES(table_source),
  frequence_secondes      = VALUES(frequence_secondes),
  usine_id                = VALUES(usine_id),
  actif                   = VALUES(actif),
  puissance_souscrite_hc  = VALUES(puissance_souscrite_hc),
  puissance_souscrite_hp  = VALUES(puissance_souscrite_hp),
  puissance_souscrite_hpo = VALUES(puissance_souscrite_hpo);

-- 3.7 Paramètres système
INSERT IGNORE INTO parametres_systeme (cle, valeur, type_valeur, description) VALUES
  ('dashboard.refresh_interval_ms', '1000', 'NUMBER',  'Intervalle WebSocket dashboard (ms)'),
  ('dashboard.pmc_window_minutes',  '10',   'NUMBER',  'Fenêtre glissante PMC (minutes)'),
  ('depassement.warning_ratio',     '0.95', 'NUMBER',  'Ratio seuil pour alerte warning');

-- 3.8 Seuils capteurs (copie depuis puissance_souscrite de chaque capteur)
INSERT IGNORE INTO seuils_capteurs (capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo)
SELECT
  c.id,
  COALESCE(c.usine_id, u.id),
  c.puissance_souscrite_hc,
  c.puissance_souscrite_hp,
  c.puissance_souscrite_hpo
FROM capteurs c
JOIN usines u ON u.id = COALESCE(c.usine_id, u.id)
WHERE c.actif = TRUE
  AND u.actif = TRUE
  AND (c.usine_id IS NULL OR c.usine_id = u.id);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- VÉRIFICATIONS (décommenter pour contrôler après migration)
-- ============================================================
-- SHOW TABLES;
-- SELECT id, code, libelle FROM roles ORDER BY id;
-- SELECT id, login, role_id, actif FROM utilisateurs ORDER BY id;
-- SELECT id, code, usine_id, frequence_secondes, actif FROM capteurs ORDER BY id;
-- SELECT saison, type_tranche, heure_debut, heure_fin FROM tranches_horaires ORDER BY saison, type_tranche;
