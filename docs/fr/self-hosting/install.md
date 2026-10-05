# Installation

::: warning Licence
PICKET est sous [licence PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).
L'héberger pour votre propre communauté, régiment ou association est autorisé ; le vendre ou le proposer comme service
payant ne l'est pas. C'est une licence « source disponible », pas une licence open source reconnue par l'OSI. Foxhole et
son contenu appartiennent à Siege Camp et ne sont pas couverts par cette licence ; PICKET n'est pas affilié à Siege Camp.
Voir les fichiers `LICENSE` et `NOTICE`.
:::

PICKET tourne comme une seule image de conteneur en plusieurs réplicas identiques, adossée à PostgreSQL. Le dossier
`deploy/` contient tout ce qu'il faut pour un hôte Docker Compose derrière Traefik.

## Prérequis

- Un hôte Linux avec Docker et Docker Compose v2.
- Le plugin [docker-rollout](https://github.com/wowu/docker-rollout), utilisé pour les mises à jour sans interruption.
- Traefik avec le provider Docker, sur un réseau Docker que le conteneur PICKET peut rejoindre.
- Un nom d'hôte public pointant vers Traefik, servi en HTTPS.

## 1. Créer l'application Discord

Dans le [Developer Portal](https://discord.com/developers/applications), créez une application et notez son
**Application ID** et sa **Public Key**. Créez le bot et copiez son token. N'activez aucun intent privilégié : PICKET n'en
a pas besoin.

## 2. Préparer l'hôte

Copiez le dossier `deploy/` sur le serveur, puis :

```sh
./init-secrets.sh                 # génère les mots de passe et chaînes de connexion de la base dans ./secrets
read -rsp 'Token du bot : ' TOKEN && printf '%s' "$TOKEN" > secrets/discord_bot_token; unset TOKEN   # hors de l'historique du shell
cp .env.example .env              # puis éditez-le : image, nom d'hôte, identifiants Discord, noms Traefik
docker compose up -d --wait postgres
```

Le dossier `secrets/` n'est jamais versionné. Les secrets arrivent dans les conteneurs sous forme de fichiers (variables
`*_FILE`), pas de variables d'environnement.

## 3. Premier démarrage

```sh
./rollout.sh ghcr.io/<propriétaire>/picket@sha256:<condensat>
```

Le script récupère l'image, applique les migrations de la base, remplace les réplicas un par un, puis enregistre les
commandes slash (seulement si leur définition a changé).

Enfin, dans le Developer Portal, renseignez **Interactions Endpoint URL** avec `https://<votre hôte>/interactions`.
Discord envoie une requête signée pour la vérifier : le point d'accès doit répondre, faites donc cette étape une fois
PICKET démarré.

## 4. Planifier le nettoyage

Les données des serveurs qui ont retiré le bot sont effacées après la période de rétention. Lancez le nettoyage chaque
jour :

```sh
0 4 * * * cd /opt/picket/deploy && docker compose run --rm purge
```

## Derrière Cloudflare

Utilisez un nom d'hôte dédié au point d'accès des interactions. Vérifiez qu'**aucun challenge, protection anti-bot ni
règle WAF** ne répond à `POST /interactions` : Discord doit joindre PICKET avec le corps de la requête inchangé, sinon la
vérification de signature échoue et Discord refuse le point d'accès.

## Mises à jour depuis GitHub Actions

Le dépôt fournit un workflow qui construit l'image, la pousse sur GitHub Container Registry et la déploie par SSH.

1. Créez une paire de clés dédiée et autorisez-la sur le serveur avec une **commande forcée**, dans
   `~/.ssh/authorized_keys` :

   ```text
   command="/opt/picket/deploy/ssh-entrypoint.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… picket-deploy
   ```

   La clé ne peut rien faire d'autre que déployer une image référencée par son condensat
   (`ghcr.io/<propriétaire>/<image>@sha256:…`).

2. Créez un environnement GitHub nommé `production`, avec des relecteurs obligatoires si vous voulez une validation
   manuelle, et ajoutez les secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` et `DEPLOY_KNOWN_HOSTS` (la clé d'hôte
   du serveur, épinglée, pour que la connexion ne fasse jamais confiance à un hôte inconnu).
3. Rien à configurer pour le registre : le workflow envoie au serveur le jeton temporaire du job (lecture des paquets), qui
   s'en sert pour télécharger l'image puis se déconnecte aussitôt. Aucun jeton personnel n'est stocké sur le serveur. Pour un
   `./rollout.sh` manuel, rendez le paquet public ou lancez vous-même `docker login ghcr.io` avant.

Le déploiement ne s'exécute qu'après une CI réussie sur `main`, jamais depuis une pull request.

## Pourquoi les mises à jour passent inaperçues

- Les changements de base de données ne font qu'ajouter ; l'ancienne et la nouvelle version cohabitent pendant la bascule.
- Un réplica qui va s'arrêter se déclare d'abord non prêt, Traefik cesse de lui envoyer des requêtes, puis il termine le
  travail en cours.
- La connexion Gateway de Discord est tenue par un seul réplica à la fois. Quand il s'arrête, il transmet la session et le
  réplica suivant la reprend sans repartir de zéro.

## Exploitation

- Les journaux sont en JSON sur la sortie standard, avec l'identifiant du serveur sur chaque ligne et aucun secret.
- `/healthz` et `/readyz` écoutent sur un port interne que Traefik ne route pas.
- Sauvegardez la base avec `pg_dump` chaque jour et testez une restauration. Tout ce que PICKET sait est dans PostgreSQL.
