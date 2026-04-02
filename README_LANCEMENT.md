# Guide De Lancement Du Projet SPuissance

Ce guide suit l'enchainement complet des taches deja implementees:
1. Base de donnees unifiee avec migration fusionnee
2. Synchronisation SQL Server -> MySQL (temps reel)
3. Demarrage backend
4. Demarrage frontend
5. Verifications fonctionnelles (depassements + dashboard)

## 1) Prerequis

- Node.js 18+
- MySQL / MariaDB
- SQL Server source accessible (instance contenant les tables MC02)
- Ports libres:
  - backend: 5000
  - frontend: 5173

## 2) Initialiser la base MySQL (migration fusionnee)

Depuis le dossier serveur, executer:

```bash
cd serveur
mysql -u root -p basetest < database/setup.sql
```

Ce script cree la structure complete et les donnees initiales:
- usines, roles, utilisateurs, capteurs, tranches_horaires
- index de performance
- parametres_systeme
- seuils_capteurs

## 3) Configurer les variables d'environnement backend

Verifier le fichier [serveur/.env](serveur/.env):

- Cible MySQL:
  - DB_HOST
  - DB_PORT
  - DB_USER
  - DB_PASSWORD
  - DB_NAME=basetest
- Source SQL Server:
  - SOURCE_DB_HOST
  - SOURCE_DB_PORT (ou SOURCE_DB_INSTANCE)
  - SOURCE_DB_USER
  - SOURCE_DB_PASSWORD
  - SOURCE_DB_NAME
  - SOURCE_DB_SCHEMA=dbo
- Synchronisation:
  - SYNC_ENABLED=true
  - SYNC_START_DATE=2026-01-01 01:00:00
  - SYNC_BUFFER_SIZE=100
  - SYNC_WRITE_THROUGH=false
  - SYNC_FLUSH_INTERVAL_MS=5000

Notes:
- `SYNC_WRITE_THROUGH=false` active le buffering pour reduire les ecritures massives.
- `SYNC_FLUSH_INTERVAL_MS` force un flush periodique (meme si le buffer n'a pas atteint `SYNC_BUFFER_SIZE`).
- Passer `SYNC_WRITE_THROUGH=true` seulement pour debug temps reel ultra-immediat.

## 4) Installer les dependances

Backend:

```bash
cd serveur
npm install
```

Frontend:

```bash
cd client
npm install
```

## 5) Demarrer le backend

```bash
cd serveur
npm run dev
```

Au demarrage backend:
- verification MySQL
- lancement initSync()
- TRUNCATE mesures
- demarrage des boucles de lecture SQL Server par capteur
- API/WS disponibles sur le port 5000

## 6) Verifier la sante backend

Ouvrir:
- http://localhost:5000/health

Verifier:
- status = ok
- sync_enabled = true
- sync_status contient les capteurs, curseurs et buffers

## 7) Demarrer le frontend

```bash
cd client
npm run dev
```

Ouvrir:
- http://localhost:5173

## 8) Enchainement de verification fonctionnelle

### 8.1 Verifier l'alimentation des mesures

En MySQL:

```sql
SELECT COUNT(*) AS nb_mesures FROM mesures;
SELECT capteur_id, COUNT(*) AS nb
FROM mesures
GROUP BY capteur_id
ORDER BY capteur_id;
```

### 8.2 Verifier la table capteurs

```sql
SELECT id, code, frequence_secondes, actif, puissance_souscrite_hp
FROM capteurs
ORDER BY id;
```

Attendu:
- A127 frequence_secondes = 1
- A137..A150 frequence_secondes = 60
- A127 puissance_souscrite_hp = 9000

### 8.3 Verifier depassements non dupliques

Le correctif anti-doublon auto 10 min est base sur un tag unique de fenetre.
Verifier qu'une meme fenetre n'a pas plusieurs insertions:

```sql
SELECT description, COUNT(*) AS nb
FROM depassements
WHERE description LIKE 'AUTO_10MIN|%'
GROUP BY description
HAVING COUNT(*) > 1;
```

Attendu:
- aucune ligne retournee

### 8.4 Verifier les 2 composants chart

Le dashboard calcule maintenant sur les donnees reelles de depassements (sans coefficients artificiels):
- Nbre de Depassements par Tranche
- Puissance Moyenne Appelee MAX par Tranche

En cas d'ecart, verifier d'abord la plage date selectionnee dans le dashboard.

## 9) Arret propre

Arret backend (Ctrl+C):
- stopSync() est appele
- flush des buffers vers MySQL
- fermeture propre

## 10) Notes utiles

- Si SQL Server n'est pas accessible et SYNC_ENABLED=true, le backend ne demarrera pas.
- Pour un demarrage backend sans sync (debug API only), passer temporairement:
  - SYNC_ENABLED=false
