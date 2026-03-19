
CREATE DATABASE IF NOT EXISTS basetest
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE basetest;

CREATE TABLE IF NOT EXISTS capteurs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL UNIQUE,
  nom VARCHAR(100) NOT NULL,
  table_source VARCHAR(100) NOT NULL,
  frequence_secondes INT NOT NULL DEFAULT 60,
  puissance_souscrite_hc DECIMAL(10,2) DEFAULT 11000,
  puissance_souscrite_hp DECIMAL(10,2) DEFAULT 11000,
  puissance_souscrite_hpo DECIMAL(10,2) DEFAULT 11000,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mesures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  date DATETIME(3) NOT NULL,
  pa_i DECIMAL(12,3) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  source_table VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mesure_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  UNIQUE KEY uq_capteur_date (capteur_id, date),
  INDEX idx_date (date),
  INDEX idx_capteur_date (capteur_id, date)
);

CREATE TABLE IF NOT EXISTS pmc_glissante (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  date DATETIME(3) NOT NULL,
  minute_courante TINYINT NOT NULL,
  pmc_kw DECIMAL(10,3) NOT NULL,
  pa_i_kw DECIMAL(10,3) NOT NULL,
  puissance_souscrite DECIMAL(10,2) NOT NULL,
  pourcentage DECIMAL(5,2) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  INDEX idx_pmc_date (date),
  INDEX idx_pmc_capteur_date (capteur_id, date)
);

CREATE TABLE IF NOT EXISTS depassements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  capteur_id INT NOT NULL,
  date DATETIME(3) NOT NULL,
  tranche_horaire ENUM('HC','HP','HPO') NOT NULL,
  pa_i_kw DECIMAL(10,3) NOT NULL,
  seuil_kw DECIMAL(10,2) NOT NULL,
  ecart_kw DECIMAL(10,3) NOT NULL,
  FOREIGN KEY (capteur_id) REFERENCES capteurs(id),
  INDEX idx_dep_date (date),
  INDEX idx_dep_tranche (tranche_horaire, date)
);

CREATE TABLE IF NOT EXISTS logs_systeme (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  niveau ENUM('INFO','WARNING','ERROR') NOT NULL,
  source VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  INDEX idx_log_date (date),
  INDEX idx_log_niveau (niveau)
);

CREATE TABLE IF NOT EXISTS tranches_horaires (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type_tranche ENUM('HC','HP','HPO') NOT NULL,
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  UNIQUE KEY uq_type_plage (type_tranche, heure_debut, heure_fin)
);

INSERT INTO capteurs
  (code, nom, table_source, frequence_secondes,
   puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo)
VALUES
  ('A127_MC02', 'Capteur A127', 'A127_MC02',  1, 11000, 11000, 11000),
  ('A137_MC02', 'Capteur A137', 'A137_MC02', 60, 11000, 11000, 11000),
  ('A138_MC02', 'Capteur A138', 'A138_MC02', 60, 11000, 11000, 11000),
  ('A139_MC02', 'Capteur A139', 'A139_MC02', 60, 11000, 11000, 11000),
  ('A144_MC02', 'Capteur A144', 'A144_MC02', 60, 11000, 11000, 11000),
  ('A145_MC02', 'Capteur A145', 'A145_MC02', 60, 11000, 11000, 11000),
  ('A146_MC02', 'Capteur A146', 'A146_MC02', 60, 11000, 11000, 11000),
  ('A147_MC02', 'Capteur A147', 'A147_MC02', 60, 11000, 11000, 11000),
  ('A148_MC02', 'Capteur A148', 'A148_MC02', 60, 11000, 11000, 11000),
  ('A150_MC02', 'Capteur A150', 'A150_MC02', 60, 11000, 11000, 11000)
ON DUPLICATE KEY UPDATE
  nom = VALUES(nom),
  table_source = VALUES(table_source),
  frequence_secondes = VALUES(frequence_secondes),
  puissance_souscrite_hc = VALUES(puissance_souscrite_hc),
  puissance_souscrite_hp = VALUES(puissance_souscrite_hp),
  puissance_souscrite_hpo = VALUES(puissance_souscrite_hpo);

INSERT IGNORE INTO tranches_horaires (type_tranche, heure_debut, heure_fin)
VALUES
  ('HC',  '22:00:00', '06:00:00'),
  ('HP',  '06:00:00', '17:00:00'),
  ('HPO', '17:00:00', '22:00:00');
