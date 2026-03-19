-- ============================================================
-- setup.sql - Installation complete base de donnees
-- Projet  : Surveillance Puissance Appelee
-- Fusion  : migrate_backup.sql + migrate_mc02.js +
--           migrate_seuils.sql + migrate_v3.sql +
--           schema_surveillance.sql
-- Usage   : mysql -u root -p basetest < database/setup.sql
-- ============================================================

-- ============================================================
-- [REMPLACE] migrate_mc02.js
-- Ce fichier JS gerait la migration initiale du capteur MC02
-- depuis le backup SQL Server vers MySQL.
-- Cette logique est desormais geree par syncService.js
-- qui lit en temps reel depuis SQL Server (frequence par capteur).
-- ============================================================

-- ---------------------------------------------------------------------------
-- ETAPE 1 : Base de donnees
-- ---------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS basetest
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE basetest;

-- ---------------------------------------------------------------------------
-- ETAPE 2 : Tables (ordre strict des dependances FK)
-- ---------------------------------------------------------------------------

-- 1) usines
CREATE TABLE IF NOT EXISTS usines (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL UNIQUE,
  nom VARCHAR(120) NOT NULL,
  localisation VARCHAR(180) NULL,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2) roles
CREATE TABLE IF NOT EXISTS roles (
  id SMALLINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL UNIQUE,
  libelle VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3) utilisateurs -> roles
CREATE TABLE IF NOT EXISTS utilisateurs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  matricule VARCHAR(50) NOT NULL UNIQUE,
  nom VARCHAR(120) NOT NULL,
  telephone VARCHAR(30) NULL,
  mail VARCHAR(150) NOT NULL UNIQUE,
  login VARCHAR(80) NOT NULL UNIQUE,
  mot_de_passe_hash VARCHAR(255) NOT NULL,
  role_id SMALLINT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  dernier_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_utilisateur_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 4) utilisateur_usines -> utilisateurs, usines
CREATE TABLE IF NOT EXISTS utilisateur_usines (
  utilisateur_id INT NOT NULL,
  usine_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (utilisateur_id, usine_id),
  CONSTRAINT fk_uu_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  CONSTRAINT fk_uu_usine FOREIGN KEY (usine_id) REFERENCES usines(id) ON DELETE CASCADE
);

-- 5) sessions_utilisateurs -> utilisateurs
CREATE TABLE IF NOT EXISTS sessions_utilisateurs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(191) NOT NULL UNIQUE,
  utilisateur_id INT NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  INDEX idx_sessions_expires (expires_at)
);

-- 6) capteurs -> usines
CREATE TABLE IF NOT EXISTS capteurs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL UNIQUE,
  nom VARCHAR(120) NOT NULL,
  table_source VARCHAR(100) NULL,
  frequence_secondes INT NOT NULL DEFAULT 60,
  usine_id INT NULL,
  type VARCHAR(80) NULL,
  description TEXT NULL,
  puissance_souscrite_hc DECIMAL(12,2) DEFAULT 11000,
  puissance_souscrite_hp DECIMAL(12,2) DEFAULT 11000,
  puissance_souscrite_hpo DECIMAL(12,2) DEFAULT 11000,
  actif BOOLEAN DEFAULT TRUE,
  installed_at DATETIME NULL,
  last_maintenance_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_capteur_usine FOREIGN KEY (usine_id) REFERENCES usines(id)
);

ALTER TABLE capteurs
  ADD COLUMN IF NOT EXISTS table_source VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS frequence_secondes INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS usine_id INT NULL,
  ADD COLUMN IF NOT EXISTS type VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS description TEXT NULL,
  ADD COLUMN IF NOT EXISTS puissance_souscrite_hc DECIMAL(12,2) DEFAULT 11000,
  ADD COLUMN IF NOT EXISTS puissance_souscrite_hp DECIMAL(12,2) DEFAULT 11000,
  ADD COLUMN IF NOT EXISTS puissance_souscrite_hpo DECIMAL(12,2) DEFAULT 11000,
  ADD COLUMN IF NOT EXISTS actif BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS installed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_maintenance_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 7) tranches_horaires
CREATE TABLE IF NOT EXISTS tranches_horaires (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nom VARCHAR(120) NOT NULL,
  saison ENUM('ete','hiver') NOT NULL,
  type_tranche ENUM('HC','HP','HPO') NOT NULL,
  prix_kw DECIMAL(10,4) NOT NULL,
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tranche_saison_type_plage (saison, type_tranche, heure_debut, heure_fin)
);

-- 8) mesures -> capteurs
CREATE TABLE IF NOT EXISTS mesures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  date DATETIME(3) NOT NULL,
  pa_i DECIMAL(12,3) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  qualite_mesure ENUM('OK','ESTIMEE','MANQUANTE') DEFAULT 'OK',
  source_table VARCHAR(100) NULL,
  source_row_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mesure_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  UNIQUE KEY uq_capteur_date (capteur_id, date)
);

-- 9) pmc_glissante -> capteurs
CREATE TABLE IF NOT EXISTS pmc_glissante (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  date DATETIME(3) NOT NULL,
  minute_courante TINYINT NOT NULL,
  points_fenetre TINYINT NOT NULL DEFAULT 0,
  pmc_kw DECIMAL(12,3) NOT NULL,
  pa_i_kw DECIMAL(12,3) NOT NULL,
  puissance_souscrite DECIMAL(12,2) NOT NULL,
  pourcentage DECIMAL(6,2) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pmc_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id)
);

-- 10) depassements -> capteurs, usines, utilisateurs
CREATE TABLE IF NOT EXISTS depassements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  usine_id INT NULL,
  date DATETIME(3) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  pa_i_kw DECIMAL(12,3) NOT NULL,
  pmc_kw DECIMAL(12,3) NULL,
  seuil_kw DECIMAL(12,2) NOT NULL,
  ecart_kw DECIMAL(12,3) NOT NULL,
  description TEXT NULL,
  acquitte BOOLEAN DEFAULT FALSE,
  acquitte_par INT NULL,
  acquitte_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dep_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  CONSTRAINT fk_dep_usine FOREIGN KEY (usine_id) REFERENCES usines(id),
  CONSTRAINT fk_dep_user FOREIGN KEY (acquitte_par) REFERENCES utilisateurs(id)
);

-- 11) depassement_capteurs -> depassements, capteurs
CREATE TABLE IF NOT EXISTS depassement_capteurs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  depassement_id BIGINT NOT NULL,
  capteur_id INT NOT NULL,
  valeur_kw DECIMAL(12,3) NOT NULL,
  seuil_kw DECIMAL(12,3) NOT NULL,
  ecart_kw DECIMAL(12,3) AS (valeur_kw - seuil_kw) STORED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_depc_dep FOREIGN KEY (depassement_id) REFERENCES depassements(id) ON DELETE CASCADE,
  CONSTRAINT fk_depc_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id) ON DELETE CASCADE
);

-- 12) alertes_systeme -> depassements, capteurs, utilisateurs
CREATE TABLE IF NOT EXISTS alertes_systeme (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  depassement_id BIGINT NULL,
  capteur_id INT NULL,
  niveau ENUM('INFO','WARNING','ERROR') NOT NULL,
  message TEXT NOT NULL,
  statut ENUM('NOUVELLE','LUE','TRAITEE') DEFAULT 'NOUVELLE',
  emitted_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  acquittee_at DATETIME NULL,
  acquittee_par INT NULL,
  CONSTRAINT fk_alerte_dep FOREIGN KEY (depassement_id) REFERENCES depassements(id) ON DELETE SET NULL,
  CONSTRAINT fk_alerte_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id) ON DELETE SET NULL,
  CONSTRAINT fk_alerte_user FOREIGN KEY (acquittee_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- 13) logs_systeme -> utilisateurs
CREATE TABLE IF NOT EXISTS logs_systeme (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  niveau ENUM('INFO','WARNING','ERROR') NOT NULL,
  source VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  utilisateur_id INT NULL,
  request_id VARCHAR(80) NULL,
  metadata JSON NULL,
  CONSTRAINT fk_log_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- 14) audit_actions -> utilisateurs
CREATE TABLE IF NOT EXISTS audit_actions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  utilisateur_id INT NULL,
  module VARCHAR(80) NOT NULL,
  action VARCHAR(80) NOT NULL,
  cible_type VARCHAR(80) NULL,
  cible_id VARCHAR(80) NULL,
  details JSON NULL,
  date_action DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- 15) parametres_systeme -> utilisateurs
CREATE TABLE IF NOT EXISTS parametres_systeme (
  cle VARCHAR(100) PRIMARY KEY,
  valeur TEXT NOT NULL,
  type_valeur ENUM('STRING','NUMBER','BOOLEAN','JSON') DEFAULT 'STRING',
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_param_user FOREIGN KEY (updated_by) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- ETAPE 3 : Donnees initiales
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO usines (id, code, nom, localisation, actif) VALUES
  (1, 'LAC', 'Laminage a Chaud', 'Site principal', TRUE),
  (2, 'ACIERIE', 'Acierie', 'Site principal', TRUE),
  (3, 'LAF', 'Laminage a Froid', 'Site secondaire', TRUE);

INSERT IGNORE INTO roles (id, code, libelle) VALUES
  (1, 'admin', 'Administrateur'),
  (2, 'superviseur_lac', 'Superviseur LAC'),
  (3, 'superviseur_acierie', 'Superviseur ACIERIE'),
  (4, 'superviseur_energie', 'Superviseur Energie');

INSERT IGNORE INTO utilisateurs
  (id, matricule, nom, telephone, mail, login, mot_de_passe_hash, role_id, actif)
VALUES
  (1, '9191', 'Admin Systeme', '+33 6 12 34 56 78', 'admin@energie.fr', 'admin', '$2a$10$ANVsQqLuRxQ0/7l79IH4cuHp23xEDTSReRWznKIQ1JeWHMmIw9cCK', 1, TRUE),
  (2, '9192', 'Superviseur LAC', '+33 6 87 65 43 21', 'lac@energie.fr', 'lac', '$2a$10$vozqJ778qYQWwmnvOf8Z1.nk1/NfR3aa.6AXpyvScuqYbNiW9LFQ6', 2, TRUE),
  (3, '9193', 'Superviseur ACIERIE', '+33 6 11 22 33 44', 'acierie@energie.fr', 'acierie', '$2a$10$3fhndejFrlezdnruN0bL2uWg/xlgkrBbN1mGTILmK9kBhDU2oU9P.', 3, TRUE),
  (4, '9194', 'Superviseur Energie', '+33 6 99 88 77 66', 'energie@energie.fr', 'energie', '$2a$10$rSoFE35VcW3bIW9zbcMESu.lSJNq0K4fTN5OPpKUQxxhLHcOpndVm', 4, TRUE);

INSERT IGNORE INTO utilisateur_usines (utilisateur_id, usine_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1),
  (3, 2),
  (4, 1), (4, 2), (4, 3);

INSERT IGNORE INTO tranches_horaires
  (nom, saison, type_tranche, prix_kw, heure_debut, heure_fin, actif)
VALUES
  ('Heures Creuses', 'ete', 'HC', 0.0800, '22:00:00', '07:00:00', TRUE),
  ('Heures Pleines', 'ete', 'HP', 0.1200, '07:00:00', '18:00:00', TRUE),
  ('Heures de Pointe', 'ete', 'HPO', 0.1800, '18:00:00', '22:00:00', TRUE),
  ('Heures Creuses', 'hiver', 'HC', 0.0900, '22:00:00', '06:00:00', TRUE),
  ('Heures Pleines', 'hiver', 'HP', 0.1400, '06:00:00', '17:00:00', TRUE),
  ('Heures de Pointe', 'hiver', 'HPO', 0.2000, '17:00:00', '22:00:00', TRUE);

INSERT IGNORE INTO capteurs
  (id, code, nom, table_source, frequence_secondes, actif,
   puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo)
VALUES
  (1,  'A127', 'Capteur A127', 'A127_MC02', 1,  TRUE, 11000,  9000, 11000),
  (2,  'A137', 'Capteur A137', 'A137_MC02', 60, TRUE, 11000, 11000, 11000),
  (3,  'A138', 'Capteur A138', 'A138_MC02', 60, TRUE, 11000, 11000, 11000),
  (4,  'A139', 'Capteur A139', 'A139_MC02', 60, TRUE, 11000, 11000, 11000),
  (5,  'A144', 'Capteur A144', 'A144_MC02', 60, TRUE, 11000, 11000, 11000),
  (6,  'A145', 'Capteur A145', 'A145_MC02', 60, TRUE, 11000, 11000, 11000),
  (7,  'A146', 'Capteur A146', 'A146_MC02', 60, TRUE, 11000, 11000, 11000),
  (8,  'A147', 'Capteur A147', 'A147_MC02', 60, TRUE, 11000, 11000, 11000),
  (9,  'A148', 'Capteur A148', 'A148_MC02', 60, TRUE, 11000, 11000, 11000),
  (10, 'A150', 'Capteur A150', 'A150_MC02', 60, TRUE, 11000, 11000, 11000)
ON DUPLICATE KEY UPDATE
  nom = VALUES(nom),
  table_source = VALUES(table_source),
  frequence_secondes = VALUES(frequence_secondes),
  actif = VALUES(actif),
  puissance_souscrite_hc = VALUES(puissance_souscrite_hc),
  puissance_souscrite_hp = VALUES(puissance_souscrite_hp),
  puissance_souscrite_hpo = VALUES(puissance_souscrite_hpo);

-- ---------------------------------------------------------------------------
-- ETAPE 4 : Index de performance
-- ---------------------------------------------------------------------------
ALTER TABLE mesures
  ADD INDEX IF NOT EXISTS idx_date_pai (date, pa_i),
  ADD INDEX IF NOT EXISTS idx_capteur_date (capteur_id, date),
  ADD INDEX IF NOT EXISTS idx_tranche (tranche_horaire, date);

ALTER TABLE pmc_glissante
  ADD INDEX IF NOT EXISTS idx_pmc_date (date),
  ADD INDEX IF NOT EXISTS idx_pmc_capteur_date (capteur_id, date);

ALTER TABLE depassements
  ADD INDEX IF NOT EXISTS idx_dep_date (date),
  ADD INDEX IF NOT EXISTS idx_dep_tranche (tranche_horaire, date),
  ADD INDEX IF NOT EXISTS idx_dep_acquitte (acquitte);

ALTER TABLE depassement_capteurs
  ADD INDEX IF NOT EXISTS idx_depc_dep (depassement_id),
  ADD INDEX IF NOT EXISTS idx_depc_capteur (capteur_id);

ALTER TABLE alertes_systeme
  ADD INDEX IF NOT EXISTS idx_alertes_niveau (niveau, emitted_at),
  ADD INDEX IF NOT EXISTS idx_alertes_statut (statut, emitted_at);

ALTER TABLE logs_systeme
  ADD INDEX IF NOT EXISTS idx_log_date (date),
  ADD INDEX IF NOT EXISTS idx_log_niveau (niveau),
  ADD INDEX IF NOT EXISTS idx_log_source_date (source, date);

ALTER TABLE audit_actions
  ADD INDEX IF NOT EXISTS idx_audit_date (date_action),
  ADD INDEX IF NOT EXISTS idx_audit_module (module, date_action);

-- ---------------------------------------------------------------------------
-- ETAPE 5 : Parametres complementaires et seuils
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO parametres_systeme (cle, valeur, type_valeur, description) VALUES
  ('dashboard.refresh_interval_ms', '1000', 'NUMBER', 'Intervalle websocket de rafraichissement dashboard'),
  ('dashboard.pmc_window_minutes', '10', 'NUMBER', 'Fenetre glissante pour le calcul PMC'),
  ('depassement.warning_ratio', '0.95', 'NUMBER', 'Ratio du seuil pour alerte warning');

-- Table complementaire issue de migrate_seuils.sql
CREATE TABLE IF NOT EXISTS seuils_capteurs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  usine_id INT NOT NULL,
  seuil_hc DECIMAL(12,2) NOT NULL DEFAULT 11000,
  seuil_hp DECIMAL(12,2) NOT NULL DEFAULT 11000,
  seuil_hpo DECIMAL(12,2) NOT NULL DEFAULT 11000,
  date_modification DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  modifie_par INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_capteur_usine (capteur_id, usine_id),
  CONSTRAINT fk_seuil_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id) ON DELETE CASCADE,
  CONSTRAINT fk_seuil_usine FOREIGN KEY (usine_id) REFERENCES usines(id) ON DELETE CASCADE,
  CONSTRAINT fk_seuil_user FOREIGN KEY (modifie_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

ALTER TABLE seuils_capteurs
  ADD INDEX IF NOT EXISTS idx_seuil_capteur_id (capteur_id),
  ADD INDEX IF NOT EXISTS idx_seuil_usine_id (usine_id),
  ADD INDEX IF NOT EXISTS idx_seuil_date_modification (date_modification);

INSERT IGNORE INTO seuils_capteurs (capteur_id, usine_id, seuil_hc, seuil_hp, seuil_hpo)
SELECT
  c.id,
  COALESCE(c.usine_id, u.id),
  c.puissance_souscrite_hc,
  c.puissance_souscrite_hp,
  c.puissance_souscrite_hpo
FROM capteurs c
CROSS JOIN usines u
WHERE c.actif = TRUE
  AND u.actif = TRUE
  AND (c.usine_id IS NULL OR c.usine_id = u.id);

-- ---------------------------------------------------------------------------
-- Verifications recommandees apres execution
-- ---------------------------------------------------------------------------
-- SHOW TABLES;
-- SELECT id, code, frequence_secondes, actif, puissance_souscrite_hp FROM capteurs ORDER BY id;
-- SELECT saison, type_tranche, heure_debut, heure_fin, prix_kw FROM tranches_horaires ORDER BY saison, type_tranche;
-- SELECT cle, valeur FROM parametres_systeme;
