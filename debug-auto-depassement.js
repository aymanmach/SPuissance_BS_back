const { getPmcCouranteGlobale } = require('./services/powerMetricsService');
const { verifierEtEnregistrerDepassementAutomatique } = require('./services/depassementService');

(async () => {
  try {
    const pmc = await getPmcCouranteGlobale();

    console.log('PMCCurrent:', {
      virtual_now: pmc.virtual_now,
      window_start: pmc.window_start,
      window_end: pmc.window_end,
      minute_courante: pmc.minute_courante,
      seconde_courante: pmc.seconde_courante,
      pmc_kw: Number(pmc.pmc_kw || 0),
      seuil_kw: Number(pmc.puissance_souscrite || 0),
      capteurs: Array.isArray(pmc.capteurs) ? pmc.capteurs.length : 0,
    });

    const result = await verifierEtEnregistrerDepassementAutomatique(pmc);
    console.log('AUTO_RESULT:', result);
  } catch (error) {
    console.error('DEBUG_ERROR:', error.message);
    process.exit(1);
  }
})();
