# Monitoring

Operator access only. The monitoring data is separate from PICKET's database,
guild journals and data exports.

## Enable

Copy the updated `deploy/` directory to the server, preserving `.env` and `secrets/`.
In `deploy/.env`, add:

```dotenv
COMPOSE_PROFILES=monitoring
MONITORING_HOST=monitoring.example.org
MONITORING_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN
```

Create the DNS entry as for the other PICKET hostnames, then run:

```sh
./init-secrets.sh
./rollout.sh ghcr.io/<owner>/picket@sha256:<digest>
```

Open `https://<MONITORING_HOST>`. The login and password are in
`secrets/grafana_admin_user` and `secrets/grafana_admin_password`. They are generated
once; changing these files later does not reset an existing Grafana account.
In **Alerting → Contact points → PICKET Discord**, send a test notification.
This sends a message to the configured Discord channel.

## What runs

Grafana displays six provisioned dashboards and routes alerts to Discord.
Prometheus collects each bot/stats replica, including during a rollout. Loki
stores sanitized JSON application diagnostics sent by Alloy. Exporters cover
PostgreSQL, the host, container resources, container health/restarts and backups.
All monitoring endpoints remain internal; Traefik exposes only Grafana over HTTPS.
The PostgreSQL monitoring role has `pg_monitor`, without application table access.

Metrics and logs have a 30-day retention. Prometheus also has a 5 GB storage
ceiling, which can shorten the history; inspect actual retention and increase
this ceiling in Compose if necessary. Loki deletes expired data asynchronously,
with a two-hour deletion delay. Docker keeps at most three 10 MB log files per
hardened service. Loki collects only the sanitized `picket` and `picket-stats`
stream; raw third-party logs remain available through `docker compose logs`.

Defaults are fixed and conservative, independent of host capacity. Monitor disk
space shared by databases, archives and monitoring. Configuration changes belong
in `deploy/monitoring/`; copy those files to the host with each update. Provisioned
dashboards and rules are managed in files, rather than edited in Grafana.

## Alerts and first actions

| Signal | When | First action |
| --- | --- | --- |
| Bot, stats, database, shard, required role or container unavailable | 10 minutes | Check `docker compose ps`, then service logs and dependency health |
| Repeated restarts | 3 in 30 minutes, excluding rollout replacements | Inspect exit status, crashes and memory usage |
| Interaction failures, slow replies, REST `429`, pool waits | Persistent 10 minutes; ratio alerts require meaningful traffic | Check latency panels, database contention and Discord budget |
| Periodic work stalled, war collection stale | Expected interval plus 10 minutes | Check collector/job errors and upstream availability |
| Nightly retention or stats refresh late | 10 minutes past its scheduled time, persisting 10 minutes | Restore dependencies; the scheduler catches up |
| CPU/RAM above 90%, disk below 20% free | 10 minutes | Identify the service consuming resources; free disposable files |
| Disk/inodes below 10%, voice buffer rejection | 10 minutes | Restore safe write capacity; preserve database and pending events |
| Backup failures continue | 1 hour since the first unresolved failure | Inspect `docker compose logs --tail=50 backup`; retries run every 15 minutes |
| No archive, or last success older than 26 hours | Condition persists 1 hour | Run `./backup.sh daily` and verify a complete archive |
| Restore verification older than 35 days | 1 day | Run the isolated monthly check below |

Discord notifications show the severity, symptom, affected area and available
service/component details, start time, first action, and named dashboard/runbook
links. Resolved alerts show the end time instead of repeating intervention
instructions; this means the alert condition cleared, not that its cause was
verified. Times display in the reader's Discord timezone. Grouped notifications
list active alerts before resolved alerts; unresolved incidents repeat every
four hours. After copying notification changes to the host, run
`docker compose restart grafana` from `deploy/` to reload provisioning.
A quiet server or a standby replica without a lease is normal.
Expected rolling updates do not require manually muting all alerts.

```sh
docker compose ps
docker compose logs --tail=100 <service>
./backup.sh daily
./restore.sh verify ../backups/<snapshot-directory> /path/to/private-age-identity
```

Run the restore check monthly; only a successful isolated restore updates its
verification timestamp. See [Disaster recovery](./disaster_recovery).

The monitoring runs on the same host: it cannot notify during a complete host
outage, or when Grafana itself cannot send notifications. This version has no
external availability probe. Monitoring history is disposable during recovery.
