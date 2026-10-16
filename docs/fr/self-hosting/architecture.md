---
aside: false
---

# Stack applicative auto-hébergée

Le diagramme décrit la stack de `deploy/compose.yml`, avec le dashboard Stats et le profil de monitoring optionnels.
Une même image PICKET exécute le bot et le dashboard dans deux conteneurs Node.js distincts ; PostgreSQL conserve
l'état partagé et coordonne les réplicas.

Suivez d’abord le trajet d’une commande : **Discord → entrée HTTPS → bot → données du serveur**.
Le dashboard utilise la même entrée pour afficher les statistiques. Les branches du bas servent à la reprise après
panne, aux sauvegardes et à la supervision.

<ArchifyDiagram diagram="self-hosted" title="Stack complète PICKET" />

<details>
<summary>Voir les services, ports, réseaux et procédures techniques</summary>

## Services et échanges

| Ensemble | Responsabilité |
| --- | --- |
| Traefik | Seul port publié : HTTPS `443`. Route `POST /interactions` vers le bot (`8080`), le dashboard vers `8082` et Grafana vers `3000`. Certificats ACME par DNS-01 Cloudflare. |
| `picket` | Quatre rôles : ingress HTTP, shards Gateway, jobs et poller war-log. Vérifie les signatures Discord, contrôle les permissions, gère todolists/timers et publie via REST. |
| `picket-stats` | Processus HTTP dédié : OAuth Discord, dashboard, rapports et droits individuels. Pool SQL borné ; la collecte vocale reste dans le bot. Sans `DASHBOARD_HOST`, seul l'endpoint de santé fonctionne. |
| PostgreSQL 18 | Données par guilde isolées par RLS, coordination par leases/fencing, sessions Gateway et OAuth, état public Foxhole et instantanés admin. |
| `voice-buffer` | Volume partagé bot/dashboard : journal vocal de reprise et marqueurs de refus/effacement. |
| `backup` | Sauvegardes planifiées et avant migration, `pg_dump` chiffré avec la clé publique age. Répertoire `BACKUP_DIR`, cinq archives maximum, aucune de plus de 30 jours. |
| Outils ponctuels | `migrate`, `deploy-commands`, `purge` et `restore`, dans le profil `tools`. Le restaurateur reçoit séparément la clé privée. |
| Monitoring | Profil `monitoring` : Grafana, Prometheus, Loki, Alloy, `node-exporter`, `postgres-exporter` et `operations-exporter`. |

## Réseaux et persistance

`edge` (`picket_edge`) relie Traefik aux services exposés et permet leurs connexions sortantes. Le réseau `internal`
est isolé : PostgreSQL et les collecteurs n'ont pas de port publié sur l'hôte. Les métriques et endpoints de santé
du bot et du dashboard restent internes, sur `8081`.

Les secrets sont montés dans `/run/secrets`. Les rôles PostgreSQL distinguent application, migrations et monitoring ;
le rôle applicatif ne contourne pas la RLS. Traefik et les collecteurs qui en ont besoin lisent le socket Docker.

Les volumes persistants sont `pgdata`, `voice-buffer`, `traefik-acme`, `grafana-data`, `prometheus-data`, `loki-data`,
`alloy-data` et `operations-state`. Les archives chiffrées sont dans le répertoire de l'opérateur, hors de ces volumes.

## Exploitation

`rollout.sh` effectue une sauvegarde vérifiée, applique les migrations, remplace progressivement le bot et le dashboard,
puis enregistre les commandes Discord. Les leases SQL assurent l'unicité des shards et des jobs pendant la coexistence
des réplicas.

Prometheus interroge toutes les 30 secondes les services et exporters. Alloy ne transmet à Loki que les diagnostics
assainis du bot et du dashboard. Grafana interroge Prometheus et Loki et peut envoyer les alertes vers un webhook Discord.
Loki conserve 30 jours ; Prometheus est limité à 30 jours ou 5 Go. La rotation des logs Docker est bornée en taille.

Pour la procédure : [installation](./install), [configuration](./configuration), [monitoring](./monitoring) et
[reprise après sinistre](./disaster_recovery). Pour les données conservées : [export et cycle de vie](./data-lifecycle).

Sources : [Compose](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/deploy/compose.yml),
[runtime bot](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/apps/bot/src/main.ts) et
[runtime dashboard](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/apps/stats/src/runtime.ts).

</details>

Les vocaux éphémères réutilisent le flux Gateway et une boucle partagée du job-runner. PostgreSQL conserve les modèles, préparations privées expirables, réservations de quota et échéances de nettoyage. Aucun watcher périodique par canal ou serveur n’est créé. Le déploiement 1.1 renouvelle une fois les snapshots Gateway pour initialiser ce nouveau consommateur persistant ; les sessions compatibles suivantes reprennent normalement.
