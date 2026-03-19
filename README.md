# Backend SPuissance

Backend Node.js/Express pour supervision energetique avec:
- Authentification par session
- Controle d'acces par roles
- API REST metier (PAI, PMC, capteurs, depassements, logs)
- Socket.IO temps reel authentifie par la meme session

Contrainte donnees actuelle (a respecter dans toute l'application):
- capteurs actifs: A127_MC02, A137_MC02, A138_MC02, A139_MC02, A144_MC02, A145_MC02, A146_MC02, A147_MC02, A148_MC02, A150_MC02
- plage de donnees disponible: du 2026-01-01 01:00:00 au 2026-01-08 16:49:31
- mode developpement: horloge virtuelle temps reel (1 seconde reelle = 1 seconde virtuelle) dans la plage ci-dessus

## 1. Installation

```bash
npm install
```

## 2. Configuration

Copier `.env.example` vers `.env` puis adapter les valeurs.
Base cible actuelle: `DB_NAME=basetest` (doit correspondre a ta vraie base).
Source capteur par defaut: SQL Server local (SSMS) via `SOURCE_DB_ENGINE=mssql`.
Mode horloge virtuelle (dashboard):
- `VIRTUAL_START_DATE=2026-01-01 01:00:00`
- `VIRTUAL_END_DATE=2026-01-08 16:49:31`

## 3. Initialiser la base

```bash
mysql -u root -p < database/schema.sql
```

Schema cible dedie migration phase 2 (10 capteurs):

```bash
mysql -u root -p < database/schema_surveillance.sql
```

## 4. Synchronisation temps reel des mesures (recommande)

Le mode recommande n'importe PAS toutes les donnees.
Il rejoue en temps reel selon l'heure courante projetee sur `SYNC_START_DATE`.

Exemple:
- heure reelle: `2026-03-18 14:52:30`
- point source lu: `2026-01-01 14:52:30`

Verifier dans `.env`:
- `SYNC_ENABLED=true`
- `SYNC_START_DATE=2026-01-01 01:00:00`

Puis demarrer le serveur:

```bash
npm run dev
```

## 5. Migration des mesures source (batch, optionnel)

Cette section est optionnelle pour un import massif historique.
Si ton objectif est le temps reel seconde par seconde, n'utilise pas cette section.

```bash
npm run migrate
```

Pour la migration Phase 2 (10 capteurs `A127_MC02` a `A150_MC02`) depuis la base source `basetest` vers `basetest`, executer:

```bash
mysql -u root -p basetest < database/migrate_backup.sql
```

Ce script:
- aligne le schema cible (colonnes `table_source`, `frequence_secondes`, `source_table`),
- met a jour/cree les 10 capteurs de reference,
- migre les mesures sans duplication (relancable en toute securite),
- affiche un rapport global de controle en fin d'execution.

Par defaut, la migration importe tous les capteurs phase 2:
- `A127_MC02, A137_MC02, A138_MC02, A139_MC02, A144_MC02, A145_MC02, A146_MC02, A147_MC02, A148_MC02, A150_MC02`

Tu peux limiter la migration a une sous-liste si besoin (ordre libre):

```powershell
$env:SOURCE_DB_TABLES='A127_MC02,A137_MC02'; npm run migrate
```

Tu peux aussi forcer une plage de dates:
- debut: `2026-01-01 01:00:00`
- fin: `2026-03-06 14:39:11`

Tu peux surcharger la plage si besoin:

```powershell
$env:MIGRATION_START_DATE='2026-01-01 01:00:00'; $env:MIGRATION_END_DATE='2026-03-06 14:39:11'; npm run migrate
```

Variables source SQL Server importantes:
- `SOURCE_DB_HOST` (ex: DESKTOP-G4GNFLN)
- `SOURCE_DB_INSTANCE` (ex: SQLEXPRESS)
- `SOURCE_DB_PORT` (optionnel, utile si SQL Browser est desactive)
- `SOURCE_DB_USER` / `SOURCE_DB_PASSWORD`
- `SOURCE_DB_NAME` (base qui contient les tables capteurs)
- `SOURCE_DB_SCHEMA` (souvent dbo)
- `SOURCE_DB_TABLES` (liste CSV; par defaut les 10 capteurs phase 2)
- `VIRTUAL_START_DATE` / `VIRTUAL_END_DATE` (fenetre du temps virtuel pour les APIs et WebSocket)

Si la connexion sur `DESKTOP-G4GNFLN\\SQLEXPRESS` timeout:
- activer `TCP/IP` pour l'instance dans SQL Server Configuration Manager,
- redemarrer le service SQL Server,
- renseigner `SOURCE_DB_PORT` avec le port TCP de l'instance.

Note: le script essaie aussi de detecter automatiquement le port TCP de l'instance via le registre Windows.

Diagnostic rapide si `mesures` semble vide:

```bash
mysql -u root -p -e "USE basetest; SELECT COUNT(*) AS mesures_count, MIN(date) AS min_date, MAX(date) AS max_date FROM mesures;"
```

Si ce compteur est a 0, verifier en priorite:
- que `DB_NAME` dans `.env` pointe vers la base que tu consultes vraiment,
- que les tables sources SQL Server (ex: `A127_MC02`, `A137_MC02`, etc.) contiennent des lignes dans la plage,
- que la migration a ete laissee aller jusqu'au message `Migration terminee avec succes`.

## 6. Demarrer le serveur

```bash
npm run dev
```

## 7. Etapes de demarrage (pas a pas)

### Option A - Base neuve (premiere installation)

1. Installer les dependances backend:

```bash
cd serveur
npm install
```

2. Initialiser le schema complet:

```bash
mysql -u root -p < database/schema.sql
```

3. Injecter les mesures source (tous les capteurs):

```bash
npm run migrate
```

Alternative multi-capteurs (script SQL Phase 2):

```bash
mysql -u root -p basetest < database/migrate_backup.sql
```

4. Demarrer le backend:

```bash
npm run dev
```

5. Demarrer le frontend (autre terminal):

```bash
cd ../client
npm install
npm run dev
```

### Option B - Base deja existante (upgrade V3)

1. Aller dans le dossier backend:

```bash
cd serveur
```

2. Appliquer la migration V3:

```bash
Get-Content .\database\migrate_v3.sql | mysql -u root -p
```

3. Verifier rapidement les tables critiques:

```bash
mysql -u root -p -e "USE basetest; SHOW TABLES;"
```

4. Lancer le backend:

```bash
npm run dev
```

5. Lancer le frontend (autre terminal):

```bash
cd ../client
npm run dev
```

### Controle rapide apres demarrage

1. Tester la sante du backend:

```bash
curl http://localhost:5000/health
```

2. Verifier la route auth:

```bash
curl http://localhost:5000/api/auth/me
```

3. Ouvrir le frontend:

- URL Vite: http://localhost:5173

## Identifiants de test

- admin / admin123
- lac / lac123
- acierie / acierie123
- energie / energie123

## Endpoints principaux

- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- GET /api/pai/courante
- GET /api/pai/evolution?debut=...&fin=...
- GET /api/pai/evolution-capteurs?debut=...&fin=...
- GET /api/pmc/courante
- GET /api/pmc/evolution?limit=600
- GET /api/pmc/evolution-capteurs?limit=1200
- GET /api/capteurs
- GET /api/capteurs/:code/stats
- GET /api/depassements/synthese
- GET /api/depassements/liste?limit=100
- PATCH /api/depassements/:id/acquitter (admin)
- GET /api/logs?limit=50 (admin)

## Socket.IO

Le serveur refuse toute connexion socket sans session valide.
Rooms utilisees:
- user-<id>
- admins

Evenements emis:
- dashboard_update
- dashboard_admin_update
- alerte
