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
| `DATABASE_POOL_MAX` | `10` | Connexions maximales par réplica (1 à 100). |
| `ROLES` | `http-ingress` | Rôles du processus, séparés par des virgules : `http-ingress` (reçoit les interactions), `shard-runner` (connexion Gateway) et `job-runner` (alertes de timers, mise à jour des tableaux et purges). Chaque réplica peut tous les exécuter : les shards et les tâches sont tenus par une seule réplique à la fois, grâce à un bail. |
| `SHARD_COUNT` | `1` | Nombre total de shards Gateway (1 à 256). Un shard suffit jusqu'à environ 2 500 serveurs. |
| `GUILD_RETENTION_DAYS` | `30` | Jours entre le moment où un serveur devient inactif et l'effacement de ses données (1 à 365). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. |
| `PICKET_VERSION` | `unknown` | Identifiant ajouté aux journaux du bot et du CLI. Compose fournit la référence de `PICKET_IMAGE` ; un build manuel peut aussi définir l’argument `PICKET_VERSION`. |
| `NODE_ENV` | `production` | `development`, `test` ou `production`. |

`DISCORD_REST_GLOBAL_RPS` et `DATABASE_POOL_MAX` sont transmis par le `.env` de Compose. Leurs valeurs par défaut
prévoient une réplique permanente et une seconde pendant la bascule. Pour plusieurs répliques, tenez compte du pic de
déploiement et des outils ponctuels avant de choisir les plafonds ; ils restent locaux à chaque processus.
Le CLI de publication des commandes utilise un budget REST distinct de 5 requêtes/s.

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

Le service `backup` utilise aussi `secrets/postgres_password` pour un dump complet, y compris les tables soumises à
FORCE RLS. Il chiffre directement le flux ; aucune archive en clair n’est écrite sur disque. `rollout.sh` bloque avant
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
