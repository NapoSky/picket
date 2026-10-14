---
aside: false
---

# Self-hosted application stack

The diagram describes `deploy/compose.yml`, including the optional Stats dashboard and monitoring profile.
One PICKET image runs the bot and dashboard in separate Node.js containers; PostgreSQL holds shared state and
coordinates replicas.

Start with a command’s path: **Discord → HTTPS entry → bot → guild data**.
The dashboard uses the same entry to display statistics. The lower branches support crash recovery, backups and monitoring.

<ArchifyDiagram diagram="self-hosted" title="Complete PICKET stack" />

<details>
<summary>See technical services, ports, networks and procedures</summary>

## Services and connections

| Group | Responsibility |
| --- | --- |
| Traefik | Only published port: HTTPS `443`. Routes `POST /interactions` to the bot (`8080`), dashboard traffic to `8082`, and Grafana to `3000`. ACME certificates use Cloudflare DNS-01. |
| `picket` | Four roles: HTTP ingress, Gateway shards, jobs and war-log poller. Verifies Discord signatures, enforces permissions, manages todolists/timers and publishes through REST. |
| `picket-stats` | Dedicated HTTP process: Discord OAuth, dashboard, reports and individual controls. Bounded SQL pool; voice collection stays in the bot. Without `DASHBOARD_HOST`, only the health endpoint runs. |
| PostgreSQL 18 | Guild data isolated by RLS, leases/fencing, Gateway and OAuth sessions, public Foxhole state and admin snapshots. |
| `voice-buffer` | Shared bot/dashboard volume: voice recovery journal and opt-out/erasure markers. |
| `backup` | Scheduled and pre-migration backups, `pg_dump` encrypted with the public age key. `BACKUP_DIR` holds at most five archives, none older than 30 days. |
| One-off tools | `migrate`, `deploy-commands`, `purge` and `restore`, using the `tools` profile. Restore receives the private key separately. |
| Monitoring | The `monitoring` profile: Grafana, Prometheus, Loki, Alloy, `node-exporter`, `postgres-exporter` and `operations-exporter`. |

## Networks and persistence

`edge` (`picket_edge`) connects Traefik to exposed services and enables outbound connections. `internal` is isolated:
PostgreSQL and collectors publish no host ports. Bot/dashboard metrics and health endpoints remain internal on `8081`.

Secrets are mounted under `/run/secrets`. PostgreSQL roles separate application, migrations and monitoring; the
application role cannot bypass RLS. Traefik and collectors that need it read the Docker socket.

Persistent volumes are `pgdata`, `voice-buffer`, `traefik-acme`, `grafana-data`, `prometheus-data`, `loki-data`,
`alloy-data` and `operations-state`. Encrypted archives live in the operator's directory outside these volumes.

## Operations

`rollout.sh` takes a verified backup, runs migrations, rolls out the bot and dashboard, then registers Discord
commands. SQL leases keep shards and jobs unique while replicas coexist.

Prometheus scrapes services and exporters every 30 seconds. Alloy sends only sanitized bot/dashboard diagnostics to
Loki. Grafana queries Prometheus and Loki and can send alerts to a Discord webhook. Loki retains 30 days; Prometheus
is bounded to 30 days or 5 GB. Docker logs rotate by size.

See [installation](./install), [configuration](./configuration), [monitoring](./monitoring),
[disaster recovery](./disaster_recovery), and [data export and lifecycle](./data-lifecycle).

Sources: [Compose](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/deploy/compose.yml),
[bot runtime](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/apps/bot/src/main.ts), and
[dashboard runtime](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/apps/stats/src/runtime.ts).

</details>
