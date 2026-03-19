const db = require('./config/db');

(async () => {
  try {
    // Capteurs actifs
    const [capteurs] = await db.query('SELECT id, code, nom, usine_id, actif FROM capteurs ORDER BY code');
    const actifs = capteurs.filter(c => c.actif);
    
    // Mesures par capteur
    const [measures] = await db.query('SELECT capteur_id, COUNT(*) as count, MAX(date) as derniere FROM mesures GROUP BY capteur_id');
    
    console.log('\n📊 ÉTAT DE LA BASE DE DONNÉES');
    console.log('═══════════════════════════════════════════════════\n');
    console.log('🔌 Capteurs:', capteurs.length, 'total');
    console.log('   ✅ Actifs:', actifs.length);
    console.log('   ❌ Inactifs:', capteurs.length - actifs.length);
    console.log('\n📋 Détail des ACTIFS:');
    
    actifs.forEach(c => {
      const m = measures.find(r => r.capteur_id === c.id);
      const count = m ? m.count : 0;
      const lastDate = m ? m.derniere : 'N/A';
      console.log(`   - ${c.code}: ${c.nom}`);
      console.log(`     Mesures: ${count}, Dernière: ${lastDate}`);
    });
    
    console.log('\n📈 Total mesures en BD:', measures.reduce((s, m) => s + m.count, 0));
    console.log('\n');
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
})();
