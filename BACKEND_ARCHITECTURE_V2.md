# 📊 Correction Affichage Graphiques — Evolution PMC 10 min courante
> Script à donner à l'agent IA pour corriger les deux graphiques

---

## 🔍 Problèmes Identifiés

### Graphique 1 — Evolution PMC Globale (axe X et Y mal adaptés)
```
PROBLÈME Y : L'axe Y affiche 150000 kW → 155000 kW
             alors que la PS globale est 22000 kW (2 capteurs actifs × 11000)
             → Les valeurs affichées semblent aberrantes

PROBLÈME X : L'axe X affiche 0:00 → 9:00 (minutes)
             alors qu'on est en fenêtre 10 min courante
             → Doit afficher HH:MM:SS réel du virtual clock
```

### Graphique 2 — Evolution PMC par départ (capteurs 1/min invisibles)
```
PROBLÈME : Les capteurs à fréquence 60s (1 mesure/minute) n'apparaissent pas
           car le graphique trace 1 point par seconde (comme A127 1/sec)
           → Les capteurs lents ont 1 point toutes les 60 secondes
           → Entre deux points, rien n'est tracé → ligne invisible

SOLUTION : Interpoler (répéter la dernière valeur connue) entre les points
           pour les capteurs fréquence = 60s
```

---

## ✅ Corrections à Apporter

---

### CORRECTION 1 — Axe Y dynamique basé sur les données réelles

```javascript
// Le domaine Y doit s'adapter aux vraies valeurs
// NE PAS fixer en dur à 150000 ou autre valeur arbitraire

// ❌ INTERDIT
domain={[150000, 155000]}
domain={[0, 200000]}

// ✅ CORRECT — domaine dynamique avec marge de 10%
const computeYDomain = (data, key = 'pmc_kw') => {
  if (!data || data.length === 0) return [0, 'auto'];
  const values = data.map(d => Number(d[key] || 0)).filter(v => v > 0);
  if (values.length === 0) return [0, 'auto'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const margin = (max - min) * 0.1 || max * 0.1 || 100;
  return [
    Math.max(0, Math.floor((min - margin) / 100) * 100),
    Math.ceil((max + margin) / 100) * 100
  ];
};

// Usage dans Recharts
<YAxis
  domain={computeYDomain(data)}
  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}  // afficher en kW
/>
```

---

### CORRECTION 2 — Axe X en temps réel HH:MM:SS

```javascript
// L'axe X doit afficher l'heure réelle (virtual clock) pas des minutes 0→9

// ❌ INTERDIT
tickFormatter={(v) => `${v}:00`}
dataKey="minute"

// ✅ CORRECT — utiliser le champ date du virtual clock
<XAxis
  dataKey="date"
  scale="time"
  type="number"
  domain={['dataMin', 'dataMax']}
  tickFormatter={(ts) => {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8); // HH:MM:SS
  }}
  tickCount={10}
/>

// ET s'assurer que les données ont date en timestamp numérique
const formattedData = data.map(d => ({
  ...d,
  date: new Date(d.date).getTime(), // convertir en timestamp ms
}));
```

---

### CORRECTION 3 — Capteurs 1/min visibles par interpolation

```javascript
// PROBLÈME : A138 (fréquence 60s) a 1 point/minute
//            A127 (fréquence 1s)  a 1 point/seconde
// Sur un graphique commun → A138 invisible entre ses points

// ✅ SOLUTION : interpoler la dernière valeur connue pour les capteurs lents
// Côté backend (powerMetricsService.js) OU côté frontend

// ── SOLUTION FRONTEND (recommandée) ──────────────────────────────────────

function interpolerDonneesParCapteur(rawData, frequenceSecondes) {
  if (frequenceSecondes <= 1) return rawData; // pas d'interpolation pour 1/sec

  if (!rawData || rawData.length === 0) return [];

  const result = [];
  const STEP_MS = 1000; // 1 seconde = résolution cible

  for (let i = 0; i < rawData.length - 1; i++) {
    const current = rawData[i];
    const next    = rawData[i + 1];
    const tStart  = new Date(current.date).getTime();
    const tEnd    = new Date(next.date).getTime();

    // Répéter la valeur courante jusqu'au prochain point
    for (let t = tStart; t < tEnd; t += STEP_MS) {
      result.push({
        date:    t,
        pmc_kw:  current.pmc_kw,
        capteur_code: current.capteur_code,
      });
    }
  }

  // Ajouter le dernier point
  const last = rawData[rawData.length - 1];
  result.push({
    ...last,
    date: new Date(last.date).getTime(),
  });

  return result;
}

// Usage dans le composant React
const donneesParCapteur = useMemo(() => {
  return capteurs.map(c => ({
    code: c.code,
    frequence: c.frequence_secondes,
    data: interpolerDonneesParCapteur(
      rawDataByCapteur[c.code] || [],
      c.frequence_secondes
    ),
  }));
}, [rawDataByCapteur, capteurs]);
```

---

### CORRECTION 4 — Graphique 2 : axe X commun aligné sur A127

```javascript
// Le graphique par départ doit avoir le MÊME axe X que le graphique global
// Référence temporelle = les timestamps de A127 (1/sec, le plus dense)

// ✅ Construire une timeline commune basée sur A127
function buildCommonTimeline(dataParCapteur) {
  // Utiliser les timestamps du capteur le plus fréquent comme référence
  const capteurRef = dataParCapteur.find(c => c.frequence === 1)
                  || dataParCapteur[0];
  if (!capteurRef) return [];

  return capteurRef.data.map(point => {
    const entry = { date: point.date };

    // Pour chaque capteur, trouver la valeur la plus proche
    for (const capteur of dataParCapteur) {
      const closest = capteur.data.reduce((prev, curr) =>
        Math.abs(curr.date - point.date) < Math.abs(prev.date - point.date)
          ? curr : prev,
        capteur.data[0] || { pmc_kw: 0 }
      );
      entry[capteur.code] = closest?.pmc_kw || 0;
    }

    return entry;
  });
}

// Usage dans Recharts MultiLine
<LineChart data={buildCommonTimeline(donneesParCapteur)}>
  <XAxis
    dataKey="date"
    type="number"
    scale="time"
    domain={['dataMin', 'dataMax']}
    tickFormatter={(ts) => new Date(ts).toTimeString().slice(0, 8)}
  />
  <YAxis domain={computeYDomain(data, 'pmc_kw')} />
  {donneesParCapteur.map(c => (
    <Line
      key={c.code}
      dataKey={c.code}
      dot={false}
      strokeWidth={c.frequence === 1 ? 1.5 : 2}  // ligne plus épaisse pour lents
      connectNulls={true}  // ← IMPORTANT : connecter les points même si gap
    />
  ))}
</LineChart>
```

---

## 📋 Checklist Agent — Avant de modifier les graphiques

- [ ] Axe Y : domaine calculé dynamiquement (`computeYDomain`) jamais en dur
- [ ] Axe X : `dataKey="date"` avec `type="number"` et `scale="time"`
- [ ] Dates converties en timestamp ms : `new Date(d.date).getTime()`
- [ ] `tickFormatter` sur X affiche `HH:MM:SS` du virtual clock
- [ ] Capteurs 1/min interpolés avec `connectNulls={true}` sur la Line
- [ ] Graphique 2 utilise une timeline commune alignée sur le capteur 1/sec
- [ ] `dot={false}` sur toutes les lignes (trop de points pour les afficher)

---

## ⚠️ Règles Spécifiques aux Fréquences Mixtes

```
Capteur A127 (1/sec) :
  → 600 points dans la fenêtre 10 min
  → Affichage naturel, 1 point/sec = fluide

Capteur A138 (1/min) :
  → 10 points dans la fenêtre 10 min
  → Sans interpolation → 10 points isolés → ligne brisée ou invisible
  → Avec interpolation → valeur répétée chaque seconde → ligne plate entre mesures
  → connectNulls={true} OBLIGATOIRE

Sur le même graphique :
  → Aligner sur la timeline A127 (référence 1/sec)
  → A138 répète sa dernière valeur connue jusqu'à la prochaine mesure
  → C'est physiquement correct : la puissance ne change pas entre deux mesures
```

---

*Graphiques : Recharts | Données : WebSocket dashboard_update*
*Capteurs actifs : A127 (1/sec) + A138 (1/min) | Fenêtre : 10 min courante*