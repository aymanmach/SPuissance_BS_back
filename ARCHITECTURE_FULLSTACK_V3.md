# Architecture Fullstack V3 - React + Node.js + MySQL

Version cible pour l application de surveillance energie, alignee avec:
- le frontend React (Dashboard + Admin)
- le backend Node.js (API REST + WebSocket)
- le schema SQL etendu dans serveur/database/schema.sql

## 1) Vue d ensemble

- Frontend React (client/src):
  - Dashboard: affichage temps reel PA_I, PMC, synthese depassements, logs.
  - Admin Panel: gestion utilisateurs, tranches horaires, depassements et capteurs.
- Backend Node.js (serveur):
  - API REST securisee par session.
  - WebSocket Socket.IO pour dashboard temps reel.
  - Services metier pour calcul PMC et detection depassements.
- Base MySQL:
  - Historique mesures et calculs.
  - Gestion complete des acteurs (roles, utilisateurs, usines, permissions par usine).
  - Journalisation technique et metier.

## 2) Mapping ecrans React -> API -> tables SQL

### Dashboard

- Carte puissance combinee (PA_I + PMC):
  - API: GET /api/pai/courante, GET /api/pmc/courante
  - Tables: mesures, pmc_glissante, capteurs
- Courbes temporelles:
  - API: GET /api/pai/evolution, GET /api/pmc/evolution
  - Tables: mesures, pmc_glissante
- Synthese depassements:
  - API: GET /api/depassements/synthese, GET /api/depassements/liste
  - Tables: depassements, depassement_capteurs, capteurs, usines
- Panneau logs:
  - API: GET /api/logs
  - Tables: logs_systeme
- Temps reel:
  - Socket events: dashboard_update, dashboard_admin_update, alerte
  - Tables lues: mesures, logs_systeme
  - Tables ecrites (recommande): alertes_systeme, audit_actions

### Admin - Gestion utilisateurs

- Liste + CRUD utilisateurs:
  - API cible: /api/admin/utilisateurs
  - Tables: utilisateurs, roles, utilisateur_usines
- Tracabilite modifications:
  - API cible: /api/admin/audit
  - Table: audit_actions

### Admin - Tranches horaires

- Liste + edition des plages ete/hiver HC/HP/HPO + prix kW:
  - API cible: /api/admin/tranches
  - Table: tranches_horaires
- Traiter l historique des changements:
  - Table: audit_actions

### Admin - Capteurs

- Liste + CRUD capteurs par usine:
  - API cible: /api/admin/capteurs
  - Tables: capteurs, usines
- Activation capteur (actif/inactif), type, description:
  - Table: capteurs

### Admin - Historique depassements

- Filtrage usine/date + details par capteur:
  - API cible: /api/depassements/liste?usine=&dateDebut=&dateFin=
  - Tables: depassements, depassement_capteurs, usines, capteurs
- Acquittement depassement:
  - API existante: PATCH /api/depassements/:id/acquitter
  - Tables: depassements, utilisateurs

## 3) Tables SQL ajoutees/etendues (V3)

Le schema V3 introduit les entites suivantes en plus du noyau initial:

- usines
  - multi-sites (LAC, ACIERIE, LAF), activite par usine.
- roles
  - roles applicatifs alignes React (admin, superviseurs).
- utilisateurs
  - attributs metier React: matricule, nom, telephone, mail, login.
- utilisateur_usines
  - affectation d un utilisateur a 1..n usines.
- sessions_utilisateurs
  - persistance session (optionnelle mais recommandee en production).
- capteurs (etendue)
  - usine, type, description, actif, maintenance.
- tranches_horaires (etendue)
  - saison, nom metier, prix_kw, plage horaire, activation.
- mesures (etendue)
  - qualite mesure + source d import.
- pmc_glissante (etendue)
  - points_fenetre pour tracer la qualite du calcul.
- depassements (etendue)
  - usine, description, acquittement detaille (qui/quand).
- depassement_capteurs
  - contribution capteur par depassement.
- alertes_systeme
  - persistence des alertes temps reel et statut de traitement.
- logs_systeme (etendue)
  - request_id, metadata JSON, utilisateur associe.
- audit_actions
  - historique de toutes les actions admin (qui a fait quoi).
- parametres_systeme
  - reglage dynamique (refresh websocket, fenetre PMC, ratio warning).

## 4) Contrats de donnees recommandes

### Utilisateur session

{
  "id": 1,
  "login": "admin",
  "nom": "Admin Systeme",
  "role": "admin",
  "usines": ["LAC", "ACIERIE", "LAF"]
}

### Depassement detail

{
  "id": 1201,
  "date": "2026-02-13T14:32:05.000Z",
  "usine": "LAC",
  "tranche_horaire": "HPO",
  "pa_i_kw": 1050,
  "seuil_kw": 1000,
  "ecart_kw": 50,
  "description": "Pic de consommation en heure de pointe",
  "acquitte": false,
  "capteurs": [
    { "capteur_code": "LAC-1002", "valeur_kw": 352, "seuil_kw": 330 }
  ]
}

## 5) Strategie d implementation progressive

1. Stabiliser la base:
- Executer schema V3 sur un environnement de dev.
- Verifier les indexes critiques (mesures.date, depassements.date).

2. Basculer authentification vers SQL:
- Remplacer le tableau users hardcode dans routes/auth.js par la table utilisateurs.
- Utiliser bcrypt compare sur mot_de_passe_hash.

3. Connecter Admin React aux endpoints:
- Utilisateurs -> utilisateurs + roles + utilisateur_usines.
- Tranches -> tranches_horaires.
- Capteurs -> capteurs + usines.
- Historique -> depassements + depassement_capteurs.

4. Ajouter audit + alerting persistant:
- Ecrire dans audit_actions sur chaque operation CRUD.
- Ecrire dans alertes_systeme lors des alertes websocket.

5. Industrialisation:
- Pagination backend, filtres date/usine, validation stricte.
- Tests API (auth, depassements, capteurs, tranches).

## 6) Benefices du schema V3

- Couvre tous les attributs visibles dans les composants React admin.
- Permet une vraie gestion multi-usines et multi-profils.
- Conserve la compatibilite avec les routes existantes pour PA_I/PMC/depassements/logs.
- Prepare l application a la production (securite, audit, observabilite).