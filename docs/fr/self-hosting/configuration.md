# Configuration

PICKET se configure par variables d'environnement. Une valeur secrète peut être fournie à la place sous forme de fichier
en suffixant le nom par `_FILE` (Docker secrets) ; fournir les deux est une erreur.

## Application

| Variable | Défaut | Signification |
| --- | --- | --- |
| `DISCORD_APPLICATION_ID` | obligatoire | Identifiant de l'application. |
| `DISCORD_PUBLIC_KEY` | obligatoire | 64 caractères hexadécimaux ; vérifie la signature des interactions reçues. |
| `DISCORD_BOT_TOKEN` / `_FILE` | obligatoire | Token du bot. Jamais journalisé. |
| `DISCORD_REST_GLOBAL_RPS` | `20` | Plafond partagé des appels REST authentifiés par processus (1 à 40). Inclut messages, rôles, salons et Gateway ; les réponses d’interaction utilisent un client distinct. |
| `DATABASE_URL` / `_FILE` | obligatoire | Chaîne de connexion PostgreSQL du **rôle applicatif** (ne possède rien, soumis à la sécurité par ligne). |
| `DATABASE_POOL_MAX` | `10` | Connexions maximales du pool principal par réplica bot (1 à 100), plus un pool distinct fixe de 2 connexions pour les verrous de messages/tableaux. |
| `ROLES` | `http-ingress` | Rôles du processus, séparés par des virgules : `http-ingress` (reçoit les interactions), `shard-runner` (connexion Gateway) et `job-runner` (alertes de timers, mise à jour des tableaux et purges). Chaque réplica peut tous les exécuter : les shards et les tâches sont tenus par une seule réplique à la fois, grâce à un bail. |
| `SHARD_COUNT` | `1` | Nombre total de shards Gateway (1 à 256). Un shard suffit jusqu'à environ 2 500 serveurs. |
| `GUILD_RETENTION_DAYS` | `30` | Jours entre le moment où un serveur devient inactif et l'effacement de ses données (1 à 365). |
| `SUPPORT_GUILD_EVENTS_CHANNEL_ID` | vide | Salon privé recevant les arrivées, retraits et retours du bot, avec uniquement le nom du serveur et l'échéance de purge au retrait. Vide : notifications désactivées. Le bot doit pouvoir voir le salon et y envoyer des messages. Les messages envoyés restent dans le salon. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. |
| `PICKET_VERSION` | `unknown` | Identifiant ajouté aux journaux du bot et du CLI. Compose fournit la référence de `PICKET_IMAGE` ; un build manuel peut aussi définir l’argument `PICKET_VERSION`. |
| `NODE_ENV` | `production` | `development`, `test` ou `production`. |

`DISCORD_REST_GLOBAL_RPS` et `DATABASE_POOL_MAX` sont transmis par le `.env` de Compose. Leurs valeurs par défaut
prévoient une réplique permanente et une seconde pendant la bascule. Pour plusieurs répliques, tenez compte du pic de
déploiement et des outils ponctuels avant de choisir les plafonds ; ils restent locaux à chaque processus.
Le CLI de publication des commandes utilise un budget REST distinct de 5 requêtes/s.

## Journal de guerre

Ajoutez `warlog-poller` à `ROLES` pour lancer le collecteur partagé. Compose l’inclut par défaut.
Toutes les répliques peuvent le déclarer ; un seul détenteur du bail collecte et diffuse. Le bot coordonne également
un budget REST authentifié de 40 requêtes/s via PostgreSQL ; la limite locale configurée continue de s’appliquer.

| Variable | Défaut | Sens |
| --- | --- | --- |
| `WAR_API_URL` | `https://war-service-live.foxholeservices.com` | Racine HTTPS de l’API du shard Foxhole. |
| `WAR_LOG_POLL_INTERVAL` | `15` | Secondes entre cycles de collecte (5 à 300). |

Appliquez les migrations avant de redémarrer les répliques, puis déployez les commandes. Les abonnements sont désactivés
par défaut ; les officiers utilisent `/warlog settings`. Une reprise reconstruit la référence publique sans rejeu historique.

## Sauvegardes Docker

Ces paramètres appartiennent au `.env` de la stack, pas à la configuration applicative du bot :

| Paramètre | Défaut | Signification |
| --- | --- | --- |
| `BACKUP_DIR` | `../backups` | Dossier de l’hôte monté dans `/backups`. Un chemin relatif est résolu depuis `deploy/` ; créez le dossier avec le mode `700` avant de démarrer. |
| `secrets/backup_recipients` | obligatoire | Clés publiques `age1…`, une par ligne, créées par `init-secrets.sh`. Conservées sur le serveur. |

`init-secrets.sh` crée aussi `secrets/backup_identity` (clé privée, mode `600`) et demande de la conserver dans un coffre
puis de la retirer du serveur. Ce fichier n’est monté dans aucun service ; il sert uniquement à la restauration.

`backup.sh` et `rollout.sh` calculent les UID/GID de l’utilisateur de déploiement et les transmettent à Compose dans
l’environnement du processus. Vous n’avez pas à les définir dans `.env` ; les scripts n’écrivent pas dans ce fichier.

Le service `backup` utilise aussi `secrets/postgres_password` pour un dump incluant les tables soumises à FORCE RLS, sauf l’historique statistique et les sessions OAuth. Il chiffre directement le flux ; aucune archive en clair n’est écrite sur disque. `rollout.sh` bloque avant
les migrations si la sauvegarde ou sa vérification échoue.

Le quotidien tourne à **03 h 30 Europe/Paris**. La conservation est fixée à **cinq sauvegardes réussies au total**,
quotidiennes et pré-migration confondues, avec une limite d’âge de **30 jours**. Ces limites ne dépendent pas de
`GUILD_RETENTION_DAYS`. Voir [l’installation](./install#_3-preparer-les-sauvegardes) pour la préparation des clés et les
droits du dossier.

## Réseau et arrêt

| Variable | Défaut | Signification |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | Port du point d'accès des interactions. |
| `HEALTH_PORT` | `8081` | Port de `/healthz` et `/readyz`. À garder interne. |
| `SHUTDOWN_DRAIN_MS` | `10000` | Durée pendant laquelle le processus se déclare « non prêt » avant de s'arrêter, pour que le reverse proxy le retire (0 à 120000). |

Le bot retire sa disponibilité dès SIGTERM. Le drainage HTTP se déroule indépendamment de l'arrêt des jobs ;
la base reste ouverte jusqu'à la fin des interactions et workers en cours. L'arrêt forcé intervient après
le drainage du proxy plus 75 secondes. Compose prévoit 15 secondes de drainage et 100 secondes de grâce ;
avec un autre superviseur, prévoyez au moins le drainage plus 75 secondes et une marge. Un job dépassant
ce délai est interrompu après le drainage de l'écoute HTTP.

## Migrations

Utilisées par la tâche `migrate` uniquement, avec le rôle **propriétaire** de la base :

| Variable | Défaut | Signification |
| --- | --- | --- |
| `DATABASE_MIGRATOR_URL` / `_FILE` | obligatoire | Chaîne de connexion du rôle propriétaire. |
| `DATABASE_APP_ROLE` | `picket_app` | Rôle qui reçoit les privilèges sur les tables. |

## Ligne de commande

```sh
node apps/bot/dist/cli.js migrate               # applique les migrations de la base
node apps/bot/dist/cli.js deploy-commands       # enregistre les commandes slash (--force pour redéployer)
node apps/bot/dist/cli.js purge                 # efface les serveurs échus, journaux > 30 jours et traces d’interaction > 7 jours
```

Depuis `deploy/`, pour les sauvegardes :

```sh
./backup.sh daily                 # sauvegarde ponctuelle chiffrée et vérifiée
./backup.sh prune                 # applique uniquement la rotation et la limite d’âge
./backup.sh start                 # démarre le service quotidien avec les droits détectés automatiquement
```

## Statistiques vocales et dashboard

L'instance officielle utilise **[https://stats.picket-foxhole.com](https://stats.picket-foxhole.com)**, avec la redirection
OAuth `https://stats.picket-foxhole.com/auth/callback`. Pour votre instance, choisissez votre propre domaine ; les
exemples ci-dessous utilisent `stats.example.org` et votre application Discord.

La collecte est désactivée par défaut dans chaque guilde. Jouez les migrations et déployez les commandes, activez **Server Members Intent** dans le Developer Portal, puis configurez `/stats settings`. Presence Intent et Message Content Intent restent désactivés. Guilds et Voice States sont demandés dans le code et ne sont pas privilégiés. Discord peut exiger une approbation pour une application vérifiée : voir [les conditions actuelles](https://docs.discord.com/developers/events/gateway#privileged-intents).

### Réglages de la stack Docker principale

Les sessions Gateway enregistrent les intents utilisés à leur ouverture. Après une mise à jour de ces intents,
ou si une ancienne session ne possède pas ce masque, le bot ouvre automatiquement une nouvelle session une fois.
Les logs du bot affichent `gateway session incompatible; identifying with current intents`, puis `gateway ready`.
Les rollouts suivants reprennent normalement les sessions compatibles. Une activité vocale jamais reçue avec
l'ancienne session ne peut pas être reconstruite.

Accordez au bot **Voir les salons** sur les salons vocaux suivis, y compris les salons privés ; les dérogations
des salons/catégories peuvent remplacer la permission accordée à l'invitation. Les statistiques ne demandent pas
**Se connecter**, **Parler** ou **Administrateur**. Le dashboard vérifie l'appartenance via les scopes OAuth de
l'utilisateur connecté. Ajouter des permissions au bot ne modifie pas les limites OAuth Discord : le dashboard
gère automatiquement les délais courts et affiche le délai à respecter pour les limites plus longues.

`picket` et `picket-stats` utilisent le même `deploy/.env`, la même image et la même base PostgreSQL. Les deux
services héritent de `x-picket-environment` dans `deploy/compose.yml` : l’ID de l’application Discord, le token
du bot et la connexion à la base existants sont réutilisés. Aucun fichier d’environnement propre aux stats ni
seconde application Discord à configurer. La clé publique du bot reste celle des signatures d’interactions ;
OAuth utilise le secret client de cette même application, un credential distinct fourni par Discord.

Renseignez ces valeurs dans **`deploy/.env`**, à partir de `deploy/.env.example` :

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `DASHBOARD_HOST` | absent | Domaine public seul, par exemple `stats.example.org`. Compose en déduit `DASHBOARD_URL=https://stats.example.org` pour les deux services et configure Traefik. Vide : dashboard désactivé. |
| `DASHBOARD_POOL_MAX` | `2` | Connexions PostgreSQL maximales par processus dédié `picket-stats` (1–10). Le bot conserve son pool `DATABASE_POOL_MAX` existant. |
| `TZ` | `Europe/Paris` | Fuseau commun de l’instance. Le job-runner du bot l’utilise pour les crons et la rétention quotidienne à 03h. |
| `STATS_ADMIN_REFRESH_CRON` | `0 0,12 * * *` | Cron à cinq champs pour les instantanés vocaux admin, interprété dans `TZ` et exécuté par le job-runner du bot. Entourez la valeur de guillemets dans `.env`. |
| `STATS_BUFFER_MAX_MIB` | `128` | Allocation disque maximale des fichiers d’événements en attente, commune aux services et aux réplicas pendant un rollout (1–1024 MiB). Les petits fichiers de verrou, compteur et confidentialité ajoutent un surcoût filesystem. |

Par exemple, pour activer le dashboard de votre instance avec le calendrier de rafraîchissement par défaut :

```dotenv
DASHBOARD_HOST=stats.example.org
DASHBOARD_POOL_MAX=2
TZ=Europe/Paris
STATS_ADMIN_REFRESH_CRON="0 0,12 * * *"
STATS_BUFFER_MAX_MIB=128
```

Les credentials restent dans **`deploy/secrets/`**, créés par le workflow existant `./init-secrets.sh` :

| Fichier | Usage |
| --- | --- |
| `secrets/discord_bot_token` | Token existant du bot, monté dans les deux services via `DISCORD_BOT_TOKEN_FILE`. |
| `secrets/database_url` | Connexion existante du rôle applicatif, montée dans les deux services via `DATABASE_URL_FILE`. |
| `secrets/discord_client_secret` | Secret OAuth2 de la même application, monté uniquement dans `picket-stats` via `DISCORD_CLIENT_SECRET_FILE`. Obligatoire lorsque le dashboard est activé ; le script crée un fichier vide, pas un credential OAuth. |

Compose fixe le port interne du dashboard à **8082** et le chemin du tampon partagé à **`/app/data/voice-buffer`**,
adossé au volume `voice-buffer`. `DASHBOARD_URL`, `DASHBOARD_PORT`, `STATS_BUFFER_PATH` et les chemins des fichiers
secrets ne sont pas des réglages à ajouter dans `deploy/.env` : le Compose actuel les déduit ou les fixe.
Changer le port interne ou le chemin du tampon exige de mettre à jour ensemble la configuration du service
et son routage ou son montage de volume.

### Activer le dashboard Docker

1. Pour l’administration de l’instance, l’application doit appartenir à une **Team Discord**. Tous les membres ayant accepté l’invitation obtiennent cet accès ; une invitation en attente ne suffit pas. Aucun filtrage supplémentaire du rôle Team, ID administrateur ou secret d’enrôlement. Les dashboards membre et officier ne nécessitent pas d’appartenir à la Team.
2. Enregistrez `https://stats.example.org/auth/callback` comme redirection OAuth2 de cette application. Les scopes utilisateurs sont `identify`, `guilds`, `guilds.members.read` : ils sont distincts des intents Gateway.
3. Lancez `./init-secrets.sh` dans `deploy/` : il crée les fichiers vides du token du bot et du secret OAuth2, à côté des secrets PostgreSQL générés. Collez le **vrai secret OAuth2** de la même application dans `secrets/discord_client_secret`. Il est distinct du token du bot et de la clé publique ; ces deux credentials sont fournis par Discord. Les valeurs existantes sont conservées lors des relances.
4. Ajoutez `DASHBOARD_HOST=stats.example.org` dans `deploy/.env`. Configurez ce domaine Cloudflare comme `PICKET_HOST`. Tout est intégré au `compose.yml` principal ; aucun override ni seconde application n'est nécessaire. Laissez le domaine absent et le fichier OAuth vide pour garder le dashboard désactivé.
5. Déployez avec le script de rollout habituel : il met à jour `picket` et `picket-stats` séparément après les migrations. Traefik envoie le dashboard vers `picket-stats:8082` et les interactions vers `picket:8080`. Chaque service a son endpoint de santé interne et son arrêt progressif.

### Lancer hors Compose

Pour un lancement Node.js manuel, configurez directement `DASHBOARD_URL` au lieu de `DASHBOARD_HOST` et
fournissez au processus HTTP les valeurs existantes `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` / `_FILE`
et `DATABASE_URL` / `_FILE`. `DISCORD_CLIENT_SECRET` / `_FILE` est obligatoire lorsque l’URL est définie.
Le processus HTTP ne demande ni `DISCORD_PUBLIC_KEY` ni les `ROLES` du bot.

| Variable | Défaut du processus | Rôle |
| --- | --- | --- |
| `DASHBOARD_URL` | absent | Origine HTTPS publique sans chemin ; hors production, HTTP est aussi autorisé sur `localhost` ou `127.0.0.1`. |
| `DASHBOARD_PORT` | `8082` | Port d’écoute HTTP du dashboard. |
| `STATS_BUFFER_PATH` | `./data/voice-buffer` | Dossier privé, persistant et partagé en écriture avec le bot. |

Le développement local réutilise `.env.example`, `.env.dev` et `compose.dev.yml` à la racine. Utilisez
`pnpm stats:dev` pour des données fictives, `pnpm stats:dev:live` pour PostgreSQL local avec une identité simulée,
ou `pnpm stats:dev:oauth` pour une vraie connexion Discord. Consultez la [configuration de développement](https://github.com/NapoSky/picket/blob/main/SELF_HOSTING.md#develop-and-test-the-stats-dashboard)
pour les commandes, credentials et ports. Les horaires restent configurés sur le bot lancé séparément.
Le lancement admin simulé prépare son instantané une fois au démarrage ; les rafraîchissements planifiés suivants nécessitent le job-runner du bot.

### Fonctionnement, rafraîchissement et rétention

Cookies de session opaques, Secure/HttpOnly/SameSite=Lax en HTTPS. État OAuth à usage unique, valable dix minutes ; tokens chiffrés et sessions expirent sous huit heures. Les mutations POST exigent une validation CSRF de même origine. Aucun token OAuth n’est transmis au JavaScript du navigateur. Une rotation du secret client invalide les sessions chiffrées existantes ; reconnectez-vous.

En production, le dashboard tourne dans **son propre processus Node.js et conteneur** (`apps/stats`), avec sa boucle événementielle et sa mémoire. Il ne démarre ni shard Gateway, ni collecteur vocal, ni job de maintenance. La collecte reste dans `picket` ; PostgreSQL et le volume privé du tampon vocal sont partagés. Le service HTTP doit pouvoir écrire dans ce volume pour les marqueurs de confidentialité et l’effacement des faits en attente. Sans domaine de dashboard, il lance uniquement sa santé interne, sans pool SQL ni écoute HTTP publique. Le secret OAuth est monté uniquement dans `picket-stats`.

Comptez **réplicas bot × (pool principal + 2 connexions de verrouillage) + réplicas stats × pool dashboard**, puis CLI, sauvegardes et administration. Un bot et un service HTTP activé utilisent par défaut 10 + 2 + 2 connexions. Les appels authentifiés avec le token du bot partagent le budget Discord PostgreSQL ; le dashboard borne aussi son débit local à 5 RPS. Les rapports utilisent les segments précis indexés et la RLS transactionnelle ; aucun Superset, Grafana, ClickHouse, Redis ou service de métadonnées BI. Les vues membre et officier calculent les totaux horaires et journaliers à la lecture. Le rapport admin global et ses exports utilisent des vues matérialisées PostgreSQL privées, reconstruites par défaut à minuit et midi. L’interface affiche la date de l’instantané ; les personnes en vocal correspondent à cette date. `STATS_ADMIN_REFRESH_CRON` et `TZ` règlent le calendrier. Le job existant avec bail gère les rafraîchissements, le rattrapage après panne et les tentatives suivantes ; le service HTTP ne rafraîchit jamais une vue. La première alimentation utilise `REFRESH` ; les suivantes utilisent `CONCURRENTLY` et publient les vues atomiquement. Un rafraîchissement peut occuper une connexion du pool principal pendant au maximum dix minutes ; mesurez et surveillez la charge réelle.

La lecture borne tout l’historique à 60 jours. Le job avec bail nettoie les lignes expirées par lots bornés, environ toutes les deux minutes ; un gros retard ou une panne peut retarder l’effacement physique. Le tampon purge les événements expirés pendant sa maintenance même si le rejeu SQL échoue. Surveillez les jobs et rétablissez les pannes rapidement. PostgreSQL reste nécessaire aux baux de shards ; le tampon ne garantit pas une collecte continue pendant une panne de la base.

L’effacement et la purge d’une guilde invalident l’instantané global dans la même transaction. Pendant sa reconstruction, rapports et exports admin sont temporairement indisponibles : aucune contribution obsolète n’est affichée. Les vues guilde et personnelles restent disponibles. Le worker vérifie les invalidations chaque minute et rafraîchit hors calendrier normal. La passe quotidienne de rétention invalide également l’instantané. Toutes les lectures appliquent les 60 jours glissants actuels, même sur un instantané plus ancien ; le nettoyage physique des agrégats suit la fin du rafraîchissement.

**Les sauvegardes excluent l’historique statistique, les données des vues matérialisées et les données OAuth/session**, tout en gardant schéma, réglages et préférences de confidentialité. Elles ne prolongent ainsi pas la rétention statistique et ne restaurent pas les activités effacées. La perte du volume de base implique la perte de cet historique. Snapshots externes, exports téléchargés et sauvegardes de l’opérateur doivent suivre la même politique : l’application ne peut pas purger les copies qu’elle ne gère pas.
