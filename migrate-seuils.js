const db = require("./config/db");

async function runMigration() {
  try {
    console.log("\n📋 Création de la table seuils_capteurs...\n");

    // 1. Créer la table
    await db.query(`
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
        CONSTRAINT fk_seuil_user FOREIGN KEY (modifie_par) REFERENCES utilisateurs(id) ON DELETE SET NULL,
        
        INDEX idx_capteur_id (capteur_id),
        INDEX idx_usine_id (usine_id),
        INDEX idx_date_modification (date_modification)
      )
    `);
    console.log("✅ Table seuils_capteurs créée");

    // 2. Insérer les seuils par défaut
    await db.query(`
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
        AND (c.usine_id IS NULL OR c.usine_id = u.id)
    `);
    console.log("✅ Seuils par défaut insérés");

    // 3. Afficher les stats
    const [result] = await db.query("SELECT COUNT(*) as count FROM seuils_capteurs");
    console.log(`\n📊 Seuils configurés: ${result[0].count}`);
    
    // 4. Afficher quelques exemples
    const [examples] = await db.query(`
      SELECT sc.id, c.code, u.code as usine, sc.seuil_hc, sc.seuil_hp, sc.seuil_hpo
      FROM seuils_capteurs sc
      JOIN capteurs c ON c.id = sc.capteur_id
      JOIN usines u ON u.id = sc.usine_id
      LIMIT 3
    `);
    
    if (examples.length > 0) {
      console.log("\n📋 Échantillons:");
      examples.forEach((ex) => {
        console.log(
          `   ${ex.code} (${ex.usine}): HC=${ex.seuil_hc}, HP=${ex.seuil_hp}, HPO=${ex.seuil_hpo}`
        );
      });
    }

    console.log("\n✅ Migration 'seuils' complétée!\n");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erreur migration:", err.message);
    process.exit(1);
  }
}

runMigration();
