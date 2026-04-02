# Lancement local sur PC Windows (avec acces a la BD source SQL Server)

Ce guide est fait pour un poste Windows local fourni par l'entreprise, avec acces a la base source SQL Server.

## 1. Prerequis a installer sur le PC

1. Node.js LTS (v18 ou plus)
2. MySQL Server (ou MariaDB) + client `mysql`
3. Git (optionnel, si vous clonez le projet)

Verification rapide dans PowerShell:

```powershell
node -v
npm -v
mysql --version
```

## 2. Recuperer le projet

Si le projet est deja sur le PC, passez a l'etape suivante.

Sinon:

```powershell
cd "C:\react project"
git clone <URL_DU_REPO> SPuissance
cd .\SPuissance
```

## 3. Configurer le backend (`serveur/.env`)

1. Ouvrir le dossier `serveur`
2. Copier `.env.example` vers `.env`
3. Renseigner les valeurs reelles du PC/serveurs

Exemple PowerShell:

```powershell
cd "C:\react project\SPuissance\serveur"
Copy-Item .env.example .env -Force
```

Variables importantes a verifier dans `serveur/.env`:

- Connexion SQL Server source:
  - `SOURCE_DB_HOST`
  - `SOURCE_DB_INSTANCE` (ou `SOURCE_DB_PORT`)
  - `SOURCE_DB_USER`
  - `SOURCE_DB_PASSWORD`
  - `SOURCE_DB_NAME`
  - `SOURCE_DB_SCHEMA=dbo`
- Connexion MySQL cible:
  - `DB_HOST=localhost`
  - `DB_PORT=3306`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME=basetest`
- Synchronisation active:
  - `SYNC_ENABLED=true`
  - `SYNC_START_DATE=2026-01-01 01:00:00`

## 4. Initialiser la base MySQL locale

Depuis `serveur`:

```powershell
mysql -u root -p basetest < .\database\setup.sql
```

Si la base `basetest` n'existe pas encore, creez-la d'abord:

```sql
CREATE DATABASE basetest;
```

Puis relancez la commande `setup.sql`.

## 5. Installer les dependances Node.js

Backend:

```powershell
cd "C:\react project\SPuissance\serveur"
npm install
```

Frontend:

```powershell
cd "C:\react project\SPuissance\client"
npm install
```

## 6. Demarrer l'application

Ouvrir 2 terminaux PowerShell.

Terminal 1 - Backend:

```powershell
cd "C:\react project\SPuissance\serveur"
npm run dev
```

Terminal 2 - Frontend:

```powershell
cd "C:\react project\SPuissance\client"
npm run dev
```

## 7. Verifications apres demarrage

1. Backend sante:
   - Ouvrir `http://localhost:5000/health`
   - Attendu: `status: ok`
2. Frontend:
   - Ouvrir `http://localhost:5173`
3. Donnees synchro:
   - Verifier que la table `mesures` se remplit dans MySQL

Requete SQL utile:

```sql
SELECT COUNT(*) AS nb_mesures, MIN(date) AS min_date, MAX(date) AS max_date
FROM mesures;
```

## 8. Identifiants de test

- `admin / admin123`
- `lac / lac123`
- `acierie / acierie123`
- `energie / energie123`

## 9. Problemes frequents et solutions

1. Erreur SQL Server inaccessible au demarrage backend:
   - verifier `SOURCE_DB_HOST` / `SOURCE_DB_INSTANCE`
   - verifier login/mot de passe SQL Server
   - si besoin, activer TCP/IP sur l'instance SQL Server
2. Erreur MySQL access denied:
   - verifier `DB_USER` / `DB_PASSWORD` dans `.env`
   - tester manuellement: `mysql -u root -p`
3. Port deja utilise:
   - backend: changer `PORT` dans `.env`
   - frontend: Vite proposera automatiquement un autre port

## 10. Arret propre

Dans chaque terminal, faire `Ctrl + C`.

Le backend effectue l'arret propre de la synchronisation avant extinction.

## 11. Mode 24/7 pour vrai test (Windows)

Pour un fonctionnement continu (jour et nuit), utilisez PM2 au lieu de laisser des terminaux ouverts.

### 11.1 Installer PM2

```powershell
npm install -g pm2 pm2-windows-startup
```

### 11.2 Preparer une execution stable

1. Build du frontend:

```powershell
cd "C:\react project\SPuissance\client"
npm run build
```

2. Verifier le backend en mode normal:

```powershell
cd "C:\react project\SPuissance\serveur"
npm run start
```

### 11.3 Lancer les 2 services avec PM2

Depuis la racine du projet:

```powershell
cd "C:\react project\SPuissance"
pm2 start ecosystem.config.cjs
pm2 save
```

Verifier:

```powershell
pm2 list
pm2 logs spuissance-backend
pm2 logs spuissance-frontend
```

### 11.4 Relance automatique apres redemarrage Windows

Configurer le demarrage auto de PM2:

```powershell
pm2-startup install
```

Ensuite redemarrez le PC et controlez:

```powershell
pm2 list
```

### 11.5 Commandes utiles 24/7

```powershell
pm2 restart all
pm2 stop all
pm2 delete all
pm2 save
```

### 11.6 Important apres une mise a jour frontend

Apres modification du code frontend, reconstruire puis relancer le process frontend:

```powershell
cd "C:\react project\SPuissance\client"
npm run build
cd "C:\react project\SPuissance"
pm2 restart spuissance-frontend
```
