# Installation

::: warning Licence
PICKET est sous [licence PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).
L'héberger pour votre propre communauté, régiment ou association est autorisé ; le vendre ou le proposer comme service
payant ne l'est pas. C'est une licence « source disponible », pas une licence open source reconnue par l'OSI. Foxhole et
son contenu appartiennent à Siege Camp et ne sont pas couverts par cette licence ; PICKET n'est pas affilié à Siege Camp.
Voir les fichiers `LICENSE` et `NOTICE`.
:::

PICKET tourne comme une seule image de conteneur en plusieurs réplicas identiques, adossée à PostgreSQL. Le dossier
`deploy/` contient tout ce qu'il faut pour un hôte Docker Compose, Traefik compris.

## Prérequis

- Un hôte Linux avec Docker, Docker Compose v2 et [BuildKit](https://docs.docker.com/build/buildkit/) activé pour construire
  l’image de sauvegarde. Si nécessaire, lancez `export DOCKER_BUILDKIT=1` dans le terminal de déploiement ; le plugin
  Buildx doit être installé (`docker buildx version`).
- Le plugin [docker-rollout](https://github.com/wowu/docker-rollout), utilisé pour les mises à jour sans interruption.
- `flock` sur l’hôte (fourni par `util-linux`), pour empêcher deux déploiements simultanés.
- Un domaine dont le DNS est géré par Cloudflare, et un jeton d'API Cloudflare limité à cette zone (**Zone → DNS → Edit**).
  La stack embarque son propre Traefik : il n'écoute que sur le port 443 et obtient ses certificats par le défi DNS, donc
  le port 80 reste fermé. Le port 443 doit être libre sur l'hôte.
- Un nom d'hôte pour le point d'accès, proxifié par Cloudflare, avec le mode SSL/TLS **Full (strict)**.

## 1. Créer l'application Discord

Dans le [Developer Portal](https://discord.com/developers/applications), créez une application et notez son
**Application ID** et sa **Public Key**. Créez le bot et copiez son token. N'activez aucun intent privilégié : PICKET n'en
a pas besoin.

## 2. Préparer l'hôte

Copiez tout le dossier `deploy/` sur le serveur, y compris `backup/`, puis placez-vous dans ce dossier :

```sh
./init-secrets.sh                 # prépare les secrets PostgreSQL et les clés de sauvegarde
read -rsp 'Token du bot : ' TOKEN && printf '%s' "$TOKEN" > secrets/discord_bot_token; unset TOKEN   # hors de l'historique du shell
read -rsp 'Token Cloudflare : ' TOKEN && printf '%s' "$TOKEN" > secrets/cloudflare_dns_token; unset TOKEN
cp .env.example .env              # puis éditez-le : image, nom d’hôte, identifiants Discord
```

Le dossier `secrets/` n'est jamais versionné. Les secrets nécessaires au fonctionnement arrivent dans les conteneurs
sous forme de fichiers (variables `*_FILE`), pas de variables d'environnement. La clé privée de sauvegarde n’est montée
dans aucun service.

## 3. Préparer les sauvegardes

Les outils de sauvegarde tournent dans leur propre conteneur, construit depuis `backup/Dockerfile` avec PostgreSQL 18,
`pg_dump` et `age`. Vous n’avez pas à installer ces outils sur le serveur. Préparez le chiffrement **avant le premier
déploiement** : une sauvegarde absente ou en échec bloque les migrations.

`init-secrets.sh` prépare aussi les clés de chiffrement, sans commande de génération supplémentaire :

| Fichier créé dans `secrets/` | Usage |
| --- | --- |
| `backup_recipients` | Clé publique, conservée sur le serveur et utilisée par le service `backup`. |
| `backup_identity` | Clé privée, créée en mode `600`, nécessaire pour restaurer les données. |

Le script utilise `age-keygen` s’il est installé, sinon il construit l’image de sauvegarde et lance cet outil avec
Docker. Il ne remplace pas les clés existantes ; une clé publique déjà présente est conservée même si la privée a été
retirée du serveur. Plusieurs clés publiques `age1…` peuvent être présentes, une par ligne.

Le script affiche une action à effectuer : **copiez `secrets/backup_identity` dans votre coffre**, vérifiez que vous
pouvez la récupérer, puis retirez cette copie du serveur. Conservez `secrets/backup_recipients` sur place.
Sans la clé privée, les sauvegardes ne pourront pas être restaurées.

Sur le serveur, depuis `deploy/`, préparez le dossier de destination avec l’utilisateur qui déploie PICKET :

```sh
install -d -m 700 ../backups
chmod 700 secrets
chmod 644 secrets/backup_recipients
```

`backup.sh` et `rollout.sh` transmettent automatiquement l’identité de l’utilisateur de déploiement à Compose lors de
leur exécution. Aucun UID/GID n’est à renseigner et les scripts ne modifient pas `.env`. Créez le dossier et lancez les
scripts avec le même utilisateur. `BACKUP_DIR=../backups` est déjà la valeur par défaut. Les secrets créés par l’init
sont lisibles dans le conteneur ; le dossier `secrets/` reste protégé sur l’hôte.

## 4. Premier démarrage

```sh
./rollout.sh ghcr.io/<propriétaire>/picket@sha256:<condensat>
```

Le script verrouille le déploiement, récupère l’image, construit l’image de sauvegarde et démarre PostgreSQL et Traefik.
Il exige ensuite une sauvegarde chiffrée vérifiée **avant** les migrations, remplace les réplicas, démarre le service de
sauvegarde quotidienne et enregistre les commandes slash (seulement si leur définition a changé).

Enfin, dans le Developer Portal, renseignez **Interactions Endpoint URL** avec `https://<votre hôte>/interactions`.
Discord envoie une requête signée pour la vérifier : le point d'accès doit répondre, faites donc cette étape une fois
PICKET démarré.

## 5. Vérifier les tâches automatiques

Le job-runner nettoie les données chaque nuit vers **03 h, heure de Paris** : serveurs dont la rétention est échue,
journaux de plus de 30 jours et traces d’interaction de plus de 7 jours. Aucun cron supplémentaire n’est nécessaire.
Retirez un ancien cron `purge` si vous l’aviez installé. Pour un nettoyage ponctuel :

```sh
docker compose run --rm purge
```

Le service `backup` sauvegarde chaque jour à **03 h 30, heure de Paris**. Après un arrêt, il rattrape une sauvegarde
absente depuis 24 h ; un échec est retenté après quinze minutes. Il conserve **cinq sauvegardes réussies maximum**,
quotidiennes et pré-migration confondues, et retire celles âgées d’au moins **30 jours**. La plus ancienne est remplacée
après vérification et publication de la nouvelle ; un échec ne lui fait pas perdre sa place.

```sh
docker compose ps backup
docker compose logs --tail=50 backup
```

Le contrôle de santé échoue après 26 h sans succès. Configurez une alerte d’exploitation sur les échecs et les
conteneurs non sains ; Docker ne fournit pas de notification à lui seul.

## Mettre à jour une installation existante

Recopiez les fichiers de `deploy/`, y compris `backup/`, en conservant votre `.env` et vos `secrets/`. Relancez
`./init-secrets.sh` pour créer les clés manquantes sans remplacer les secrets existants. Mettez la clé privée à l’abri,
et renseignez les [nouveaux paramètres](./configuration#sauvegardes-docker) et le dossier comme ci-dessus.
Le déploiement de l’image du bot ne met pas ces fichiers de l’hôte à jour.

Avant le prochain déploiement, vérifiez une sauvegarde puis démarrez le quotidien :

```sh
./init-secrets.sh
docker compose build backup
docker compose up -d --wait postgres
./backup.sh pre-migration
./backup.sh start
```

Les valeurs par défaut `DISCORD_REST_GLOBAL_RPS=20` et `DATABASE_POOL_MAX=10` conviennent au budget d’une réplique
permanente et de son chevauchement pendant un déploiement. Si vous avez plusieurs répliques, dimensionnez les deux
plafonds sur leur pic simultané avant de déployer.

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

- Les journaux du bot et du CLI sont en JSON sur la sortie standard, avec le champ `version` ; les événements liés à un
  serveur portent aussi son identifiant. Les secrets ne sont pas journalisés.
- `/healthz` et `/readyz` écoutent sur un port interne que Traefik ne route pas.
- Les sauvegardes sont chiffrées dans `../backups` par défaut. Une copie sur le même disque ne protège pas contre sa
  perte : prévoyez une copie indépendante, soumise aux mêmes limites de rétention.
- Testez une restauration dans un environnement isolé : vérifiez `picket.dump.age.sha256`, déchiffrez avec la clé privée
  et utilisez `pg_restore --exit-on-error` sur une base vide après création des rôles de cette stack. Le dump contient
  les données de tous les serveurs malgré la sécurité par ligne, les fonctions, politiques, propriétaires et droits ;
  il ne contient pas les rôles globaux ni leurs mots de passe. Il ne restaure pas les messages Discord ni les cases
  cochées des todolists.
