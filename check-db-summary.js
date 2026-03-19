const db = require('./config/db');

(async () => {
  try {
    // Summary only
    const [capteurs] = await db.query('SELECT COUNT(*) as total, SUM(actif) as active FROM capteurs');
    const [measures] = await db.query('SELECT COUNT(*) as total_measures, COUNT(DISTINCT capteur_id) as capteurs_with_data FROM mesures');
    
    console.log('\n📊 RÉSUMÉ BD');
    console.log('═════════════════════════');
    console.log('Capteurs actifs:', capteurs[0].active, '/', capteurs[0].total);
    console.log('Mesures totales:', measures[0].total_measures);
    console.log('Capteurs avec données:', measures[0].capteurs_with_data);
    console.log('');
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
})();
