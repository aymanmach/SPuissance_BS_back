const db = require('./config/db');

async function cleanup() {
  try {
    // Désactiver les capteurs avec données corrompues
    const sql = "UPDATE capteurs SET actif = 0 WHERE code IN ('A137', 'A139', 'A144', 'A145', 'A146', 'A147', 'A148', 'A150')";
    const [result] = await db.query(sql);
    console.log('✅ Capteurs corrompus désactivés:', result.affectedRows, 'capteur(s)');
    
    // Vérifier les capteurs actifs
    const [rows] = await db.query('SELECT id, code, nom FROM capteurs WHERE actif = 1 ORDER BY code');
    console.log('\n📊 Capteurs actifs:', rows.length);
    rows.forEach(r => console.log(`  - ${r.code} (${r.nom})`));
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

cleanup();
