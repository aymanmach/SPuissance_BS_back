# 🔀 Fusion des Fichiers de Migration — Tâche Agent
> Instruction claire pour fusionner 5 fichiers en 1 seul fichier propre

---

## 🎯 Objectif

Fusionner ces 5 fichiers en **UN SEUL fichier** `database/setup.sql` :
```
migrate_backup.sql
migrate_mc02.js
migrate_seuils.sql
migrate_v3.sql
schema_surveillance.sql
```

---

## 📋 Règles de Fusion OBLIGATOIRES

### 1. Ordre d'exécution strict
```
Le fichier final doit respecter CET ORDRE EXACT :

  ÉTAPE 1 — Création de la base de données
  ÉTAPE 2 — Création de toutes les tables (dans l'ordre des dépendances FK)
  ÉTAPE 3 — Insertion des données initiales
             (usines, roles, utilisateurs, capteurs, tranches)
  ÉTAPE 4 — Ajout des index de performance
  ÉTAPE 5 — Paramètres complémentaires et seuils
```

### 2. Ordre des tables (dépendances FK)
```
Créer dans cet ordre EXACT (une table ne peut pas référencer
une table qui n'existe pas encore) :

  1.  usines
  2.  roles
  3.  utilisateurs               ← dépend de roles
  4.  utilisateur_usines         ← dépend de utilisateurs, usines
  5.  sessions_utilisateurs      ← dépend de utilisateurs
  6.  capteurs                   ← dépend de usines
  7.  tranches_horaires
  8.  mesures                    ← dépend de capteurs
  9.  pmc_glissante              ← dépend de capteurs
  10. depassements               ← dépend de capteurs, usines, utilisateurs
  11. depassement_capteurs       ← dépend de depassements, capteurs
  12. alertes_systeme            ← dépend de depassements, capteurs, utilisateurs
  13. logs_systeme               ← dépend de utilisateurs
  14. audit_actions              ← dépend de utilisateurs
  15. parametres_systeme         ← dépend de utilisateurs
```

### 3. Utiliser IF NOT EXISTS partout
```sql
-- Toujours utiliser ces formes pour éviter les erreurs si re-exécuté
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
INSERT IGNORE INTO ...
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
```

### 4. Gérer le fichier migrate_mc02.js (fichier JavaScript)
```
migrate_mc02.js est un fichier JavaScript — NE PAS le convertir en SQL
Extraire uniquement la logique et l'ajouter comme commentaire dans setup.sql :

-- ============================================================
-- [REMPLACÉ] migrate_mc02.js
-- Ce fichier JS gérait la migration initiale du capteur MC02
-- depuis le backup SQL Server vers MySQL.
-- Cette logique est désormais gérée par syncService.js
-- qui lit en temps réel depuis SQL Server (fréquence par capteur).
-- ============================================================
```

### 5. Éliminer les doublons
```
Si une table, un index ou une insertion apparaît dans plusieurs fichiers :
→ Ne la garder QU'UNE SEULE FOIS dans le fichier final
→ Garder la version la plus complète
   (celle avec le plus de colonnes et de contraintes)
→ En cas de conflit sur une valeur de données initiales,
   garder la valeur du fichier le plus récent (migrate_v3.sql)
```

### 6. Structure du fichier final
```sql
-- ============================================================
-- setup.sql — Installation complète base de données
-- Projet  : Surveillance Puissance Appelée
-- Fusion  : migrate_backup.sql + migrate_mc02.js +
--           migrate_seuils.sql + migrate_v3.sql +
--           schema_surveillance.sql
-- Usage   : mysql -u root -p basetest < database/setup.sql
-- ============================================================

-- ── ÉTAPE 1 : Base de données ─────────────────────────────
CREATE DATABASE IF NOT EXISTS basetest ...

-- ── ÉTAPE 2 : Tables ──────────────────────────────────────
-- (dans l'ordre des dépendances FK listées ci-dessus)

-- ── ÉTAPE 3 : Données initiales ───────────────────────────
-- usines, roles, utilisateurs, capteurs, tranches_horaires

-- ── ÉTAPE 4 : Index de performance ────────────────────────
-- idx_capteur_date, idx_date_pai, idx_log_date, etc.

-- ── ÉTAPE 5 : Paramètres et seuils ────────────────────────
-- parametres_systeme, seuils capteurs
```

---

## ⚠️ Points d'Attention Critiques

```
❌ NE PAS dupliquer les CREATE TABLE
❌ NE PAS mélanger l'ordre (ex: mesures avant capteurs)
❌ NE PAS oublier les contraintes FK
❌ NE PAS perdre les données initiales des capteurs

✅ Garder TOUS les index de performance :
   idx_capteur_date, idx_date_pai, idx_log_date
   idx_dep_date, idx_pmc_capteur_date, etc.

✅ Garder les données initiales COMPLÈTES :

   usines (3 lignes) :
     LAC, ACIERIE, LAF

   roles (4 lignes) :
     admin, superviseur_lac, superviseur_acierie, superviseur_energie

   utilisateurs (4 lignes) :
     admin / lac / acierie / energie (avec leurs hash bcrypt existants)

   tranches_horaires (6 lignes) :
     HC, HP, HPO × (été + hiver) avec prix_kw

   capteurs (10 lignes) — DONNÉES EXACTES :
     id | code  | frequence_secondes | actif
      1 | A127  |         1          |   1
      2 | A137  |        60          |   1
      3 | A138  |        60          |   1
      4 | A139  |        60          |   1
      5 | A144  |        60          |   1
      6 | A145  |        60          |   1
      7 | A146  |        60          |   1
      8 | A147  |        60          |   1
      9 | A148  |        60          |   1
     10 | A150  |        60          |   1
     puissance_souscrite_hc/hp/hpo = 11000 pour tous
     SAUF A127 : puissance_souscrite_hp = 9000

   parametres_systeme (3 lignes) :
     dashboard.refresh_interval_ms = 1000
     dashboard.pmc_window_minutes  = 10
     depassement.warning_ratio     = 0.95
```

---

## ✅ Vérification après fusion

```sql
-- Exécuter ces 4 requêtes pour valider le résultat

-- 1. Toutes les tables présentes
SHOW TABLES;
-- Attendu : 15 tables

-- 2. Les 10 capteurs avec leurs fréquences
SELECT id, code, frequence_secondes, actif,
       puissance_souscrite_hp
FROM capteurs ORDER BY id;
-- A127 doit avoir frequence_secondes=1 et puissance_souscrite_hp=9000

-- 3. Les tranches horaires
SELECT saison, type_tranche, heure_debut, heure_fin, prix_kw
FROM tranches_horaires ORDER BY saison, type_tranche;
-- 6 lignes attendues

-- 4. Les paramètres système
SELECT cle, valeur FROM parametres_systeme;
-- 3 lignes attendues
```

---

## 📌 Résultat Attendu

```
Avant (5 fichiers) :          Après (1 fichier) :
├── migrate_backup.sql        ├── database/
├── migrate_mc02.js           │   └── setup.sql
├── migrate_seuils.sql
├── migrate_v3.sql
└── schema_surveillance.sql
```

**Commande d'exécution unique :**
```bash
mysql -u root -p basetest < database/setup.sql
```

---

*Fusion migration — Projet Surveillance Puissance Appelée*
*Base cible : basetest (MySQL/MariaDB 10.4+)*