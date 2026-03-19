# 🤖 Guide Agent IA — Backend Surveillance Puissance Appelée
> Script de référence : règles, pièges connus, bonnes pratiques
> Stack : Node.js + MySQL + Socket.io | 10 capteurs | 6.7M lignes

---

## 🎯 Contexte du Projet

Tu travailles sur un backend Node.js pour une application de **surveillance de
puissance énergétique industrielle** en temps réel.

### Stack technique
- **Backend** : Node.js + Express
- **Base de données** : MySQL (6.7 millions de lignes dans `mesures`)
- **Temps réel** : Socket.io
- **Frontend** : React.js (déjà finalisé)
- **Structure** : `client/` (React) + `serveur/` (Node.js)

### Les 10 capteurs
| Code | Fréquence | Points / fenêtre 10 min |
|---|---|---|
| A127_MC02 | 1 mesure / seconde | 600 points |
| A137_MC02 | 1 mesure / minute | 10 points |
| A138_MC02 | 1 mesure / minute | 10 points |
| A139_MC02 | 1 mesure / minute | 10 points |
| A144_MC02 | 1 mesure / minute | 10 points |
| A145_MC02 | 1 mesure / minute | 10 points |
| A146_MC02 | 1 mesure / minute | 10 points |
| A147_MC02 | 1 mesure / minute | 10 points |
| A148_MC02 | 1 mesure / minute | 10 points |
| A150_MC02 | 1 mesure / minute | 10 points |

### Paramètres énergétiques
```
Puissance Souscrite (PS)  = 11 000 kW par capteur
PS globale (10 capteurs)  = 110 000 kW
Maximum physique réel     = 22 000 kW par capteur (2× PS)
Fenêtre PMC               = 10 minutes = 600 secondes
Seuil WARNING             = 95% de la PS
Seuil ERROR / dépassement = 100% de la PS
```

---

## 🧮 RÈGLE N°1 — Calcul PMC (Puissance Moyenne Cumulée)

### Formule
```
PMC (kW) = Somme des PA_I valides dans la fenêtre / Nombre de PA_I valides

Fenêtre = 10 minutes glissantes = 600 secondes

Nombre de points attendus = 600 / frequence_secondes
  → A127_MC02 (freq=1)  : 600 / 1  = 600 points
  → Autres    (freq=60) : 600 / 60 =  10 points

PMC globale = Somme des PMC de chaque capteur actif
% PS        = (PMC / PS_tranche) × 100
```

### Implémentation correcte
```javascript
// ✅ CORRECT — diviser par le nombre de valeurs RÉELLEMENT reçues
const validCount = queue.length;
const pmc = validCount > 0 ? pmcSum / validCount : 0;

// ❌ INTERDIT — ne jamais diviser par le nombre attendu
const pmc = pmcSum / expectedPoints; // fausse la PMC si données manquantes
```

### Fenêtre glissante par capteur
```javascript
const PMC_WINDOW_SECONDS = 600;

function getExpectedPoints(frequenceSecondes) {
  const freq = Math.max(1, Number(frequenceSecondes || 60));
  return Math.max(1, Math.floor(PMC_WINDOW_SECONDS / freq));
}

// Maintenir une queue glissante par capteur
const queue = queueByCapteur.get(capteurId) || [];
queue.push(newValue);
if (queue.length > getExpectedPoints(freq)) {
  queue.shift(); // retirer la plus ancienne valeur
}
```

---

## ⚠️ RÈGLE N°2 — Filtrage des Valeurs Aberrantes

### Problème connu
La table `mesures` contient des valeurs corrompues issues du backup SQL :
```
214748.365 kW → dépassement du type INT signé MySQL (2147483647 / 1000)
→ fausse complètement la PMC → pourcentages aberrants (ex: 1952%)
```

### Filtre OBLIGATOIRE — toujours appliquer
```javascript
const MAX_VALID_PAI_KW = Number(process.env.MAX_VALID_PAI_KW || 22000);

// Dans TOUTES les requêtes MySQL sur pa_i
WHERE pa_i > 0
  AND pa_i <= ?   -- MAX_VALID_PAI_KW = 22000

// Dans TOUT traitement JS avant calcul
const valeur = Number(row.pa_i || 0);
if (isNaN(valeur) || valeur <= 0 || valeur > MAX_VALID_PAI_KW) {
  continue; // ignorer cette mesure
}
```

### Règle de validité
```
PA_I valide   ⟺  0 < PA_I ≤ 22000 kW
PA_I invalide ⟺  PA_I ≤ 0  |  PA_I > 22000  |  NULL  |  NaN
```

> ⚠️ NE PAS fixer la limite à PS (11000 kW) car les dépassements sont
> normaux et attendus. La limite est le MAXIMUM PHYSIQUE (2× PS = 22000 kW).

---

## 🚫 RÈGLE N°3 — Performance WebSocket (critique)

### Problème connu — blocage après quelques secondes
```
SYMPTÔME : L'application se bloque quelques secondes après le lancement
CAUSE    : Un interval setInterval() créé PAR utilisateur connecté
           → N users = N × 3 requêtes lourdes / seconde sur 6.7M lignes
           → Saturation MySQL garantie
```

### Pattern INTERDIT
```javascript
// ❌ INTERDIT — interval par utilisateur
io.on("connection", (socket) => {
  const interval = setInterval(async () => {
    const payload = await buildDashboardPayload(); // recalcul complet
    socket.emit("dashboard_update", payload);
  }, 1000);
});
```

### Pattern OBLIGATOIRE — cache partagé + interval global
```javascript
// ✅ OBLIGATOIRE — cache partagé entre tous les utilisateurs
let _cache = null;
let _cacheTime = 0;
const CACHE_MS = 1000;

async function getOrBuildPayload() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_MS) return _cache;
  _cache = await buildDashboardPayload();
  _cacheTime = now;
  return _cache;
}

// ✅ UN SEUL interval global pour tous les utilisateurs
function initWebSocket(server) {
  const io = new Server(server, { /* ... */ });

  // Interval global — 1 seul calcul / seconde quel que soit le nb de users
  setInterval(async () => {
    try {
      const payload = await getOrBuildPayload();
      io.emit("dashboard_update", payload);
    } catch (err) {
      console.error("WebSocket error:", err.message);
    }
  }, 1000);

  io.on("connection", (socket) => {
    // Envoyer le cache immédiatement à la connexion
    getOrBuildPayload().then(p => socket.emit("dashboard_update", p));
    socket.on("disconnect", () => {});
  });
}
```

---

## 🗄️ RÈGLE N°4 — Requêtes MySQL sur 6.7M lignes

### Index obligatoires
```sql
-- Sans ces index, chaque requête scanne les 6.7M lignes → timeout
ALTER TABLE mesures
  ADD INDEX IF NOT EXISTS idx_capteur_date (capteur_id, date DESC),
  ADD INDEX IF NOT EXISTS idx_date_pai     (date, pa_i);

ALTER TABLE logs_systeme
  ADD INDEX IF NOT EXISTS idx_log_date (date DESC);
```

### Requêtes interdites
```javascript
// ❌ INTERDIT — pas de LIMIT → charge toute la table en mémoire
const [rows] = await db.query(`SELECT * FROM mesures WHERE capteur_id = ?`, [id]);

// ❌ INTERDIT — fenêtre trop large sans index
const [rows] = await db.query(`SELECT * FROM mesures WHERE date >= ?`, [debut]);

// ✅ CORRECT — toujours borner avec WHERE + LIMIT
const [rows] = await db.query(
  `SELECT pa_i, date FROM mesures
   WHERE capteur_id = ? AND date BETWEEN ? AND ?
     AND pa_i > 0 AND pa_i <= ?
   ORDER BY date ASC`,
  [capteurId, debut, fin, MAX_VALID_PAI_KW]
);
```

### Requête dernière mesure par capteur — pattern optimisé
```javascript
// ✅ Pattern correct pour la dernière mesure de chaque capteur
SELECT c.id, m.pa_i, m.date
FROM capteurs c
LEFT JOIN (
  SELECT m1.*
  FROM mesures m1
  INNER JOIN (
    SELECT capteur_id, MAX(date) AS max_date
    FROM mesures
    WHERE date <= ?
      AND pa_i > 0
      AND pa_i <= ?
    GROUP BY capteur_id
  ) latest ON latest.capteur_id = m1.capteur_id
          AND latest.max_date   = m1.date
) m ON m.capteur_id = c.id
WHERE c.actif = TRUE
```

---

## 🔐 RÈGLE N°5 — Authentification JWT / Session

### Problème connu — 401 Unauthorized au démarrage
```
SYMPTÔME : Failed to load resource: 401 Unauthorized sur /api/auth/me
CAUSE    : Token absent ou expiré dans le header Authorization
           OU middleware auth appliqué globalement sur toutes les routes
```

### Vérifications à faire
```javascript
// 1. Le middleware auth NE doit PAS bloquer /api/auth/login
app.use('/api/auth/login', authRoutes);           // ✅ pas de middleware
app.use('/api/pmc', authMiddleware, pmcRoutes);   // ✅ protégé

// 2. Le frontend doit envoyer le token dans chaque requête
headers: { 'Authorization': `Bearer ${token}` }

// 3. Pour les tests — bypass temporaire acceptable
module.exports = (req, res, next) => next(); // bypass
```

---

## 🕐 RÈGLE N°6 — Virtual Clock

Le projet utilise un **Virtual Clock** (`virtualClockService`) pour rejouer
les données historiques du backup comme si elles étaient en temps réel.

### Règles d'utilisation
```javascript
// ✅ TOUJOURS utiliser le virtual clock pour les timestamps
const virtualNow    = getVirtualNow();          // jamais new Date() directement
const virtualNowSql = toSqlDateTime(virtualNow);

// ✅ TOUJOURS borner les requêtes avec le virtual clock
WHERE date <= ?   -- virtualNowSql
```

### Ne jamais faire
```javascript
// ❌ INTERDIT — utiliser l'heure réelle du serveur pour les requêtes
WHERE date <= NOW()
WHERE date <= ?   // avec new Date() au lieu de getVirtualNow()
```

---

## 📐 RÈGLE N°7 — Structure des fichiers

```
serveur/
├── config/
│   ├── db.js              → pool MySQL — NE PAS modifier
│   ├── constants.js       → PS, seuils — modifier ici uniquement
│   └── session.js         → session middleware
├── services/
│   ├── powerMetricsService.js  → PMC + PAI — fonctions principales
│   ├── virtualClockService.js  → horloge virtuelle — NE PAS modifier
│   └── trancheService.js       → détection HC/HP/HPO
├── websocket/
│   └── realtime.js        → cache partagé + interval global UNIQUEMENT
├── routes/                → endpoints REST — 1 fichier par domaine
└── server.js              → point d'entrée — NE PAS alourdir
```

### Règle de responsabilité
```
powerMetricsService.js  → TOUT le calcul PMC/PAI (ne pas dupliquer ailleurs)
realtime.js             → UNIQUEMENT cache + emit (pas de calcul)
routes/                 → UNIQUEMENT appel service + réponse HTTP
```

---

## ✅ Checklist avant chaque modification

Avant de modifier ou créer du code, vérifie :

- [ ] Le filtre `pa_i > 0 AND pa_i <= 22000` est présent dans toutes les requêtes MySQL
- [ ] Aucun `setInterval` n'est créé dans le bloc `io.on("connection", ...)`
- [ ] Toutes les requêtes MySQL ont une clause `WHERE` bornée + `LIMIT` si nécessaire
- [ ] Le virtual clock `getVirtualNow()` est utilisé à la place de `new Date()`
- [ ] La PMC est divisée par `validCount` (nb réel) et jamais par `expectedPoints`
- [ ] Aucun calcul lourd n'est fait dans `realtime.js` (déléguer à `powerMetricsService`)
- [ ] Les index MySQL `idx_capteur_date` et `idx_date_pai` sont en place

---

## 🐛 Problèmes connus & Solutions rapides

| Symptôme | Cause | Solution |
|---|---|---|
| PMC = 1952% | Valeur corrompue `214748 kW` | Filtre `pa_i <= 22000` |
| Blocage après 5-10 sec | `setInterval` par user | Cache partagé + interval global |
| 401 au démarrage | Token absent / middleware global | Vérifier header + ordre des routes |
| Requête lente > 5 sec | Pas d'index sur `mesures` | `ALTER TABLE ADD INDEX` |
| PMC sous-estimée | Division par `expectedPoints` | Diviser par `validCount` |
| `NaN` ou `Infinity` | Division par zéro | `validCount > 0 ? sum/validCount : 0` |

---

*Projet : Surveillance Puissance Appelée | 10 capteurs | PS = 11 000 kW | 6.7M lignes*