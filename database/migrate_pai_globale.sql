USE basetest;

-- ---------------------------------------------------------------------------
-- Capteur dedie a l'archivage de la PAI globale (meme source que la card
-- Puissance Moyenne Cumulee: table A127_MC02 sur le serveur lie SQL Server),
-- echantillonne chaque seconde, pour permettre un vrai calcul historique du
-- MAX par tranche (contrairement a la procedure PCons_reelle_T10DX qui ne
-- garde qu'une fenetre glissante de 10 minutes).
-- ---------------------------------------------------------------------------
INSERT INTO capteurs
  (code, nom, frequence_secondes, usine_id, type, description,
   puissance_souscrite_hc, puissance_souscrite_hp, puissance_souscrite_hpo, actif)
VALUES
  ('PAI_GLOBALE', 'PAI Globale (A127_MC02)', 1, (SELECT id FROM usines WHERE code = 'LAF'), 'global_pai',
   'PAI globale echantillonnee chaque seconde depuis A127_MC02 (meme source que la card Puissance Moyenne Cumulee), pour historiser le vrai max par tranche',
   11000, 11000, 11000, TRUE)
ON DUPLICATE KEY UPDATE
  nom = VALUES(nom),
  usine_id = VALUES(usine_id),
  type = VALUES(type),
  description = VALUES(description),
  frequence_secondes = VALUES(frequence_secondes),
  actif = VALUES(actif);
