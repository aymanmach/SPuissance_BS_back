# Guide de Déploiement — SPuissance
> Déploiement sur serveur local entreprise | Accès : `http://SBpuissance`

---

npm run db:reset

## Comptes par défaut (créés automatiquement à la migration)

| Login | Mot de passe | Rôle | Accès usines |
|---|---|---|---|
| `admin` | `admin123` | Administrateur | LAC + ACIÉRIE + LAF |
| `superviseur` | `superviseur123` | Superviseur | LAC + ACIÉRIE + LAF |
| `superviseur_lac` | `lac123` | Superviseur LAC | LAC uniquement |
| `superviseur_laf` | `laf123` | Superviseur LAF | LAF uniquement |
| `superviseur_acierie` | `acierie123` | Superviseur ACIÉRIE | ACIÉRIE uniquement |
| `superviseur_energie` | `energie123` | Superviseur Énergie | LAC + ACIÉRIE + LAF |

> ⚠️ Changer les mots de passe en production via l'onglet **Gestion d'accès** du panneau Admin.

---

## Architecture cible

```
[PC Dev]  →  git push  →  [Serveur local entreprise]
                              ├── Backend Node.js   (PM2,   port 5000)
                              ├── Frontend buildé   (Nginx, port 80)
                              └── MySQL/MariaDB      (port 3306)

Accès final : http://SBpuissance  (depuis tout PC du réseau)
```

---

## Étape 1 — Prérequis serveur

```bash
node --version    # v18 LTS minimum (v20 recommandé)
npm --version     # v9+
mysql --version   # MySQL 8.0+ ou MariaDB 10.6+
git --version
```

Installer PM2 et Nginx :

```bash
# PM2
npm install -g pm2

# Nginx (Linux)
sudo apt install nginx -y
sudo systemctl enable nginx

# Nginx (Windows) : télécharger nginx.org/en/download.html
```

---

## Étape 2 — Récupérer le code

### Première installation
```bash
git clone <URL_DU_REPO> /opt/spuissance
cd /opt/spuissance
```

### Mise à jour (version existante avec erreurs)
```bash
cd /opt/spuissance

# Sauvegarder les fichiers .env avant le pull
cp serveur/.env serveur/.env.backup
cp client/.env.production client/.env.production.backup 2>/dev/null || true

# Récupérer la dernière version
git fetch origin
git pull origin main

# Restaurer les .env
cp serveur/.env.backup serveur/.env
cp client/.env.production.backup client/.env.production 2>/dev/null || true
```

---

## Étape 3 — Configurer les variables d'environnement

### `serveur/.env`
```bash
cp /opt/spuissance/serveur/.env.example /opt/spuissance/serveur/.env
nano /opt/spuissance/serveur/.env
```

```env
# Base de données
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=VOTRE_MOT_DE_PASSE_DB
DB_NAME=basetest

# Serveur
PORT=5000
NODE_ENV=production
SESSION_SECRET=CHANGER_CE_SECRET_LONG_32_CHARS_MIN

# Frontend (Nginx sur port 80)
FRONTEND_URL=http://SBpuissance
CORS_ALLOWED_ORIGINS=http://SBpuissance

# Synchronisation SQL Server
# Mettre false si SQL Server non accessible au premier démarrage
SYNC_ENABLED=false
SOURCE_DB_ENGINE=mssql
SOURCE_DB_HOST=DESKTOP-XXXXXXXX
SOURCE_DB_INSTANCE=SQLEXPRESS
SOURCE_DB_USER=sa
SOURCE_DB_PASSWORD=VOTRE_MOT_DE_PASSE_SQLSERVER
SOURCE_DB_NAME=backup_usine
SOURCE_DB_TABLES=A127,A21,A12,A120,A128,A18,A15,A135
```

### `client/.env.production`
```bash
echo "VITE_API_BASE_URL=http://SBpuissance" > /opt/spuissance/client/.env.production
```

---

## Étape 4 — Initialiser la base de données

### Créer la base et l'utilisateur MySQL
```sql
-- mysql -u root -p
CREATE DATABASE IF NOT EXISTS basetest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON basetest.* TO 'root'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Lancer la migration unique (`init.sql`)
```bash
mysql -u root -p basetest < /opt/spuissance/serveur/database/init.sql
```

### Vérifier
```bash
mysql -u root -p basetest -e "
  SELECT 'Tables:' AS info, COUNT(*) AS total FROM information_schema.tables WHERE table_schema='basetest';
  SELECT id, login, role_id, actif FROM utilisateurs ORDER BY id;
  SELECT id, code, usine_id, actif FROM capteurs ORDER BY id;
"
```

Résultat attendu : **16 tables**, **6 utilisateurs**, **8 capteurs** (usine_id = 3 → LAF).

> Si la migration doit être rejouée proprement :
> ```bash
> mysql -u root -p -e "DROP DATABASE IF EXISTS basetest;"
> mysql -u root -p -e "CREATE DATABASE basetest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
> mysql -u root -p basetest < /opt/spuissance/serveur/database/init.sql
> ```

---

## Étape 5 — Installer les dépendances

```bash
# Backend
cd /opt/spuissance/serveur
npm install --omit=dev

# Frontend
cd /opt/spuissance/client
npm install
```

---

## Étape 6 — Test local avec `npm run dev` (avant PM2)

> **Faire ce test sur le serveur avant de passer à PM2.**

Ouvrir **deux terminaux** :

**Terminal 1 — Backend :**
```bash
cd /opt/spuissance/serveur
npm run dev
# → Devrait afficher : "Serveur backend actif sur le port 5000"
```

**Terminal 2 — Frontend :**
```bash
cd /opt/spuissance/client
# Créer un .env.local pour le dev local
echo "VITE_API_BASE_URL=http://localhost:5000" > .env.local
npm run dev
# → Interface sur http://localhost:5173
```

Tester dans le navigateur du serveur : `http://localhost:5173`

- [ ] Page de login affichée
- [ ] Connexion `admin / admin123` fonctionne
- [ ] Dashboard charge des données (ou affiche vide si pas de sync)
- [ ] Onglet **Capteurs** : 10 capteurs affichés
- [ ] Onglet **Historique** : tableau vide ou données si sync active
- [ ] Onglet **Gestion d'accès** : 6 utilisateurs affichés
- [ ] Onglet **Paramétrage TH** : tranches horaires affichées

Une fois validé : `Ctrl+C` dans les deux terminaux pour arrêter.

---

## Étape 7 — Build production du frontend

```bash
cd /opt/spuissance/client
# Supprimer le .env.local de test
rm -f .env.local
# Builder avec l'URL de production
npm run build
# → Génère client/dist/
```

---

## Étape 8 — Lancer avec PM2

```bash
# Backend
cd /opt/spuissance/serveur
pm2 start server.js --name spuissance-backend

# Vérifier
pm2 status
pm2 logs spuissance-backend --lines 30
# Doit afficher "Serveur backend actif sur le port 5000"

# Sauvegarder pour redémarrage automatique
pm2 save
pm2 startup
# → Copier-coller la commande sudo affichée
```

---

## Étape 9 — Configurer Nginx (proxy frontend + backend)

```bash
sudo nano /etc/nginx/sites-available/spuissance
```

```nginx
server {
    listen 80;
    server_name SBpuissance;

    # Frontend React (fichiers statiques)
    root /opt/spuissance/client/dist;
    index index.html;

    # Routing SPA → toujours index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API backend → Node.js port 5000
    location /api/ {
        proxy_pass         http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    # WebSocket (socket.io temps réel)
    location /socket.io/ {
        proxy_pass         http://127.0.0.1:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
    }
}
```

```bash
# Activer le site
sudo ln -sf /etc/nginx/sites-available/spuissance /etc/nginx/sites-enabled/spuissance
sudo rm -f /etc/nginx/sites-enabled/default

# Tester la configuration
sudo nginx -t

# Appliquer
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## Étape 10 — DNS local réseau entreprise

Pour que `http://SBpuissance` soit accessible depuis tous les PCs :

### Option A — DNS d'entreprise *(recommandé)*
Demander à l'admin réseau d'ajouter :
```
SBpuissance  →  <IP_DU_SERVEUR>
```

### Option B — fichier hosts *(test rapide)*
Sur chaque PC client, éditer `C:\Windows\System32\drivers\etc\hosts` :
```
192.168.x.x    SBpuissance
```

---

## Étape 11 — Vérification finale

| Test | URL | Résultat attendu |
|---|---|---|
| Health backend | `http://SBpuissance/api/health` | `{"status":"ok"}` |
| Frontend | `http://SBpuissance` | Page de login |
| Login admin | `http://SBpuissance` → `admin/admin123` | Dashboard |
| WebSocket | Console navigateur F12 → Network → WS | Connexion active |

---

## Mise à jour de l'application

```bash
cd /opt/spuissance

# 1. Récupérer les changements
git pull origin main

# 2. Mettre à jour les dépendances si package.json a changé
cd serveur && npm install --omit=dev
cd ../client && npm install

# 3. Rejouer la migration si init.sql a changé
#    (les INSERT IGNORE n'écrasent pas les données existantes)
mysql -u root -p basetest < /opt/spuissance/serveur/database/init.sql

# 4. Rebuilder le frontend
cd /opt/spuissance/client && npm run build

# 5. Redémarrer le backend
pm2 restart spuissance-backend

# Nginx relit les fichiers dist automatiquement — pas besoin de restart
```

---

## Résolution de problèmes

| Problème | Cause probable | Solution |
|---|---|---|
| Page blanche | Frontend mal buildé ou mauvais `root` Nginx | Vérifier `client/dist/index.html` et le chemin dans nginx.conf |
| API 502 Bad Gateway | Backend non démarré | `pm2 restart spuissance-backend` |
| `ECONNREFUSED` au démarrage | MariaDB arrêtée | `sudo systemctl start mariadb` |
| Erreur CORS | `FRONTEND_URL` incorrect dans `.env` | Mettre exactement `http://SBpuissance` |
| WebSocket déconnecté | Nginx sans `Upgrade` | Vérifier le bloc `location /socket.io/` |
| Capteurs vides | Rôle non-admin | Se connecter avec `admin / admin123` |
| Dépassements vides | `SYNC_ENABLED=false` ou SQL Server KO | Vérifier la connexion source et `pm2 logs` |
| `http://SBpuissance` introuvable | DNS non configuré | Ajouter l'entrée DNS ou fichier hosts (Étape 10) |

---

## Commandes PM2 utiles

```bash
pm2 status                              # état des processus
pm2 logs spuissance-backend --lines 50  # derniers logs
pm2 restart spuissance-backend          # redémarrer
pm2 stop spuissance-backend             # arrêter
pm2 monit                               # monitoring temps réel
```

---

## Récapitulatif des ports

| Service | Port | Accès |
|---|---|---|
| Nginx (frontend + proxy API) | 80 | `http://SBpuissance` |
| Backend Express (direct) | 5000 | `http://SBpuissance:5000` (interne) |
| Frontend Vite (dev uniquement) | 5173 | `http://localhost:5173` |
| MySQL/MariaDB | 3306 | interne uniquement |
