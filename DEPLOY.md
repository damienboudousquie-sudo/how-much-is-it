# Mettre « how much is it ? » sur un VPS Netcup

Compte environ 30 minutes. À la fin, le site tourne sur ton propre serveur, en HTTPS, derrière Cloudflare (gratuit). Render peut rester en place en parallèle.

## Ce qu'il te faut

- Un VPS Netcup (VPS 1000 conseillé) avec **Debian 12** ou **Debian 13**.
- Un nom de domaine (par exemple un `.eu` ou un `.fr`).
- Un compte Cloudflare gratuit : https://dash.cloudflare.com/sign-up

## Installation express (une seule commande)

Connecte-toi au serveur (`ssh root@TON_IP`), puis :

```bash
curl -fsSL https://raw.githubusercontent.com/damienboudousquie-sudo/how-much-is-it/master/deploy/install.sh | sh -s -- tondomaine.eu
```

Sans domaine pour l'instant, enlève `-- tondomaine.eu` : le site répond sur `http://TON_IP`. Relance la même commande avec le domaine quand il est prêt. Le détail des étapes suit, pour comprendre ou faire à la main.

## 1. Commander le VPS

1. Va sur https://www.netcup.com/en/server/vps et prends le **VPS 1000** (4 vCPU, 8 Go de RAM). L'emplacement Nuremberg ou Vienne est le plus proche de la France.
2. Choisis l'image **Debian 12 (ou 13) minimal**.
3. Netcup t'envoie par e-mail l'**adresse IP** et le **mot de passe root**. Les accès sont aussi dans le Server Control Panel (SCP) : https://www.servercontrolpanel.de

## 2. Se connecter au serveur depuis Windows

Ouvre **Terminal** (ou PowerShell) :

```powershell
ssh root@TON_IP
```

Réponds `yes` la première fois, puis colle le mot de passe root (rien ne s'affiche pendant la saisie, c'est normal).

Change tout de suite ce mot de passe :

```bash
passwd
```

## 3. Installer Docker et le pare-feu

Copie-colle ce bloc d'un coup :

```bash
apt update && apt upgrade -y
apt install -y git curl ufw
curl -fsSL https://get.docker.com | sh
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Vérifie que Docker fonctionne : `docker compose version` doit afficher une version.

## 4. Récupérer le projet

Le dépôt GitHub est public, aucun mot de passe n'est donc nécessaire :

```bash
cd /opt
git clone https://github.com/damienboudousquie-sudo/how-much-is-it.git
cd how-much-is-it
```

Crée le fichier de réglages (remplace `tondomaine.eu` par ton vrai domaine) :

```bash
cat > .env <<'EOF'
SITE_ADDRESS=tondomaine.eu, www.tondomaine.eu
# Facultatif : clés de l'API osu! si tu en as
# OSU_CLIENT_ID=
# OSU_CLIENT_SECRET=
EOF
```

## 5. Brancher le domaine sur Cloudflare

1. Dans Cloudflare, clique sur **Add a domain**, entre ton domaine et choisis l'offre **Free**.
2. Cloudflare te donne **2 serveurs de noms** (du type `xxx.ns.cloudflare.com`). Va chez ton registraire et remplace ses serveurs de noms par ces deux-là (5 minutes à quelques heures).
3. Dans **DNS → Records**, ajoute :
   - Type `A`, nom `@`, contenu `TON_IP`, nuage **orange** (proxied).
   - Type `A`, nom `www`, contenu `TON_IP`, nuage **orange**.
4. Dans **SSL/TLS → Overview**, choisis le mode **Full (strict)**.
5. Laisse **Always Use HTTPS** désactivé (SSL/TLS → Edge Certificates) : Caddy redirige déjà vers HTTPS, et Let's Encrypt doit pouvoir vérifier le domaine en HTTP.

## 6. Le certificat HTTPS

Rien à faire : Caddy obtient tout seul un certificat Let's Encrypt gratuit pour ton domaine au premier lancement, et le renouvelle. (Si tu préfères le certificat d'origine Cloudflare, voir `deploy/Caddyfile.origin`.)

## 7. Lancer le site

```bash
docker compose up -d --build
```

Le premier lancement prend 2 à 4 minutes (installation et build). Ensuite :

```bash
docker compose ps          # les deux services doivent être "running"
docker compose logs -f app # les logs du site (Ctrl+C pour quitter)
```

Ouvre `https://tondomaine.eu` : c'est en ligne.

## Mettre à jour le site

Après chaque push sur GitHub :

```bash
cd /opt/how-much-is-it
./deploy/update.sh
```

## Analyse complète du catalogue

Au démarrage, le serveur lit en tâche de fond **toutes** les maps ranked osu! (environ 150 000 difficultés), en laissant la priorité aux recherches. Il retient où il en est, même après un redémarrage, et refait un passage chaque jour pour les nouvelles maps classées.

- Suivre l'avancement : `https://tondomaine.eu/api/scan` (`known` = maps analysées, `catalogue` = total).
- Quand `finishedAt` est rempli, télécharge `https://tondomaine.eu/api/patterns-seed.json.gz` et range-le dans `data/patterns-seed.json.gz` du projet (puis push sur GitHub). Tout nouveau serveur connaîtra alors le type de chaque map dès le démarrage.
- Réglages facultatifs dans `.env` : `ANALYSIS_CONCURRENCY=16` (téléchargements en parallèle), `FULL_SCAN=0` pour couper l'analyse complète.

## Bon à savoir

- **Cache** : les analyses de maps et les plages de PP sont gardées dans un volume Docker. Elles survivent aux redémarrages et aux mises à jour, donc le site devient plus rapide au fil du temps.
- **Redémarrage automatique** : si le serveur reboot, Docker relance tout seul le site.
- **Sauvegarde** : active les snapshots dans le SCP Netcup avant une grosse mise à jour.
- **Problème de certificat (erreur 526)** : regarde `docker compose logs caddy`. Le plus souvent, les serveurs de noms ne pointent pas encore vers Cloudflare, ou « Always Use HTTPS » est activé. Corrige puis lance `docker compose restart caddy`.
- **Erreur 521/522** : le serveur ne répond pas ; vérifie `docker compose ps` et `ufw status`.
- **Couper Render** : quand le nouveau site fonctionne, tu peux supprimer le service sur Render ou le laisser comme secours.
