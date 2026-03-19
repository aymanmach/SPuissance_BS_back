-- Migration: Création de la table seuils_capteurs pour configuration dynamique des seuils
-- Date: 2026-03-18

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
  
  -- Constraints
  UNIQUE KEY uk_capteur_usine (capteur_id, usine_id),
  CONSTRAINT fk_seuil_capteur FOREIGN KEY (capteur_id) REFERENCES capteurs(id) ON DELETE CASCADE,
  CONSTRAINT fk_seuil_usine FOREIGN KEY (usine_id) REFERENCES usines(id) ON DELETE CASCADE,
  CONSTRAINT fk_seuil_user FOREIGN KEY (modifie_par) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  
  -- Indexes
  INDEX idx_capteur_id (capteur_id),
  INDEX idx_usine_id (usine_id),
  INDEX idx_date_modification (date_modification)
);

-- Insérer les seuils par défaut si la table est vide (utiliser les PS des capteurs)
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
