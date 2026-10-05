# Configuration

PICKET se configure par variables d'environnement. Une valeur secrète peut être fournie à la place sous forme de fichier
en suffixant le nom par `_FILE` (Docker secrets) ; fournir les deux est une erreur.

## Application

| Variable | Défaut | Signification |
| --- | --- | --- |
| `DISCORD_APPLICATION_ID` | obligatoire | Identifiant de l'application. |
| `DISCORD_PUBLIC_KEY` | obligatoire | 64 caractères hexadécimaux ; vérifie la signature des interactions reçues. |
| `DISCORD_BOT_TOKEN` / `_FILE` | obligatoire | Token du bot. Jamais journalisé. |
| `DATABASE_URL` / `_FILE` | obligatoire | Chaîne de connexion PostgreSQL du **rôle applicatif** (ne possède rien, soumis à la sécurité par ligne). |
| `DATABASE_POOL_MAX` | `10` | Connexions maximales par réplica (1 à 100). |
| `ROLES` | `http-ingress` | Rôles du processus, séparés par des virgules : `http-ingress` (reçoit les interactions), `shard-runner` (connexion Gateway) et `job-runner` (alertes de timers, mise à jour des tableaux et purges). Chaque réplica peut tous les exécuter : les shards et les tâches sont tenus par une seule réplique à la fois, grâce à un bail. |
| `SHARD_COUNT` | `1` | Nombre total de shards Gateway (1 à 256). Un shard suffit jusqu'à environ 2 500 serveurs. |
| `GUILD_RETENTION_DAYS` | `30` | Jours entre le moment où un serveur devient inactif et l'effacement de ses données (1 à 365). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. |
| `NODE_ENV` | `production` | `development`, `test` ou `production`. |

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
node apps/bot/dist/cli.js purge                 # efface les serveurs au-delà de la rétention et les traces d'interactions de plus de 7 jours
```
