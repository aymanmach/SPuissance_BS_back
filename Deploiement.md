# Guide de déploiement — SBpuissance
> Déploiement sur serveur local entreprise | Accès : `http://SBpuissance`

---

## Architecture cible

```
[PC Dev]  →  git push  →  [Serveur local entreprise]
                              ├── Backend Node.js (PM2, port 5000)
                              ├── Frontend buildé (Nginx, port 80)
                              └── MySQL (base de données)

Accès final : http://SBpuissance  (depuis tout PC du réseau)
```

---

## Étape 1 — Prérequis serveur

Vérifier que le serveur dispose de :

```bash
node --version    # v20.x LTS minimum
mysql --version   # MySQL ou MariaDB
npm --version     # v9+
```

Installer PM2 et Nginx :

```bash
# PM2 (gestionnaire de process Node.js)
npm install -g pm2

# Nginx
# Windows : télécharger depuis https://nginx.org/en/download.html
# Linux   :
sudo apt install nginx
```

---

## Étape 2 — Récupérer le code

```bash
git clone <URL_DU_REPO> C:/SPuissance
cd C:/SPuissance

# Dépendances backend
cd serveur
npm install

# Dépendances frontend
cd ../client
npm install
```

---

## Étape 3 — Configurer les variables d'environnement

### `serveur/.env`

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=<ton_user_mysql>
DB_PASSWORD=<ton_password>
DB_NAME=spuissance
SESSION_SECRET=<une_longue_chaine_aleatoire>

SYNC_ENABLED=true
SOURCE_DB_HOST=<ip_sqlserver>
SOURCE_DB_PORT=1433
SOURCE_DB_USER=<user>
SOURCE_DB_PASSWORD=<password>
SOURCE_DB_NAME=<base_source>
SOURCE_DB_SCHEMA=dbo
SYNC_START_DATE=2026-01-01 01:00:00

FRONTEND_URL=http://SBpuissance
```

> ⚠️ Si SQL Server n'est pas encore accessible, mettre `SYNC_ENABLED=false` temporairement.

### `client/.env`

```env
VITE_API_BASE_URL=http://SBpuissance/api
```

---

## Étape 4 — Initialiser la base MySQL

```bash
cd C:/SPuissance/serveur
mysql -u root -p spuissance < database/setup.sql
```

---

## Étape 5 — Builder le frontend

```bash
cd C:/SPuissance/client
npm run build
```

> Génère le dossier `client/dist` — c'est ce que Nginx va servir.

---

## Étape 6 — Lancer le backend avec PM2

```bash
cd C:/SPuissance/serveur
pm2 start server.js --name spuissance-backend
pm2 save
pm2 startup
```

Vérification :

```bash
pm2 status                      # doit afficher "online"
pm2 logs spuissance-backend     # logs en direct
```

---

## Étape 7 — Configurer Nginx

Éditer `nginx/conf/nginx.conf` :

```nginx
server {
    listen 80;
    server_name SBpuissance;

    # Frontend (fichiers statiques buildés)
    root C:/SPuissance/client/dist;
    index index.html;

    # Routing React → toujours index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API backend → Node.js
    location /api/ {
        proxy_pass http://127.0.0.1:5000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket (socket.io)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Démarrer Nginx :

```bash
# Windows
cd C:/nginx
nginx.exe

# Linux
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Étape 8 — DNS local (réseau entreprise)

Pour que `http://SBpuissance` soit accessible depuis tous les PCs du réseau :

### Option A — DNS d'entreprise *(recommandé)*

Demander à l'admin réseau d'ajouter un enregistrement DNS interne :

```
SBpuissance  →  <IP_du_serveur>
```

### Option B — fichier `hosts` *(test rapide sur un PC)*

Éditer `C:\Windows\System32\drivers\etc\hosts` :

```
192.168.x.x    SBpuissance
```

---

## Étape 9 — Vérification finale

| Test | URL | Résultat attendu |
|---|---|---|
| Backend health | `http://SBpuissance/api/health` | `{"status":"ok"}` |
| Frontend | `http://SBpuissance` | Page de login |
| Dashboard admin | `http://SBpuissance/admin` | Dashboard visible |
| WebSocket | Console navigateur (F12) | Aucune erreur CORS |

---

## Mise à jour future

```bash
cd C:/SPuissance
git pull origin main

# Rebuilder le frontend
cd client
npm run build

# Redémarrer le backend
cd ../serveur
pm2 restart spuissance-backend
```

---

## Problèmes fréquents

| Problème | Cause probable | Solution |
|---|---|---|
| Page blanche | Frontend mal buildé ou mauvais `root` Nginx | Vérifier `client/dist` et le chemin dans nginx.conf |
| API 502 Bad Gateway | Backend non démarré | `pm2 status` puis `pm2 restart spuissance-backend` |
| Erreur CORS | `FRONTEND_URL` incorrect dans `.env` | Mettre exactement `http://SBpuissance` |
| WebSocket déconnecté | Nginx sans config `Upgrade` | Vérifier le bloc `location /socket.io/` |
| Pas de données | `SYNC_ENABLED=false` ou SQL Server inaccessible | Vérifier la connexion source et les logs PM2 |
| `http://SBpuissance` introuvable | DNS non configuré | Étape 8 — ajouter l'entrée DNS ou hosts |