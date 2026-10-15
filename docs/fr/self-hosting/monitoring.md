# Monitoring

Accès opérateur uniquement. Ces données sont séparées de la base PICKET, des
journaux de guilde et des exports de données.

## Activer

Recopier `deploy/` sur le serveur en conservant `.env` et `secrets/`.
Ajouter dans `deploy/.env` :

```dotenv
COMPOSE_PROFILES=monitoring
MONITORING_HOST=monitoring.example.org
MONITORING_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN
```

Créer l'entrée DNS comme pour les autres domaines PICKET, puis lancer :

```sh
./init-secrets.sh
./rollout.sh ghcr.io/<owner>/picket@sha256:<digest>
```

Ouvrir `https://<MONITORING_HOST>`. Identifiant et mot de passe se trouvent dans
`secrets/grafana_admin_user` et `secrets/grafana_admin_password`. Ils sont générés
une seule fois ; modifier ces fichiers ne réinitialise pas un compte Grafana
existant. Dans **Alerting → Contact points → PICKET Discord**, envoyer une
notification de test. Elle publie un message dans le salon Discord configuré.

## Services

Grafana fournit six dashboards et envoie les alertes Discord. Prometheus collecte
chaque réplique du bot et de stats, y compris pendant un rollout. Loki conserve
les diagnostics JSON assainis transmis par Alloy. Les exporters suivent
PostgreSQL, l'hôte, les ressources des conteneurs, leur santé et leurs
redémarrages, ainsi que les sauvegardes. Tous les endpoints de collecte restent
internes ; Traefik expose uniquement Grafana en HTTPS. Le rôle PostgreSQL de
supervision dispose de `pg_monitor`, sans accès aux tables applicatives.

La rétention est de 30 jours pour les métriques et les logs. Prometheus possède
aussi un plafond de 5 Go pouvant raccourcir l'historique ; contrôler sa durée
réelle et augmenter ce plafond dans Compose si nécessaire. Loki supprime les
données expirées de manière asynchrone, avec un délai de suppression de deux
heures. Docker conserve au plus trois fichiers de 10 Mo par service durci.
Loki collecte uniquement le flux assaini de `picket` et `picket-stats` ; les logs
bruts des composants tiers restent consultables avec `docker compose logs`.

Les réglages sont fixes et conservateurs, indépendants des capacités de l'hôte.
Surveiller le disque partagé entre base, archives et monitoring. La configuration
se trouve dans `deploy/monitoring/`, à recopier sur l'hôte avec les mises à jour.
Dashboards et règles provisionnés se modifient dans les fichiers.

## Alertes et premières actions

| Signal | Délai | Première action |
| --- | --- | --- |
| Bot, stats, base, shard, rôle requis ou conteneur indisponible | 10 minutes | Vérifier `docker compose ps`, les logs et les dépendances |
| Redémarrages répétés | 3 en 30 minutes, hors remplacement de rollout | Examiner code de sortie, erreurs et consommation mémoire |
| Erreurs d'interaction, réponses lentes, `429`, attente du pool | Persistance de 10 minutes ; les ratios exigent un trafic suffisant | Consulter latences, contention SQL et budget Discord |
| Boucle bloquée ou collecte war-log périmée | Intervalle attendu + 10 minutes | Examiner les erreurs du collecteur/job et ses dépendances |
| Purge nocturne ou rafraîchissement stats en retard | 10 minutes après l'échéance, pendant 10 minutes | Rétablir les dépendances ; le scheduler rattrape le retard |
| CPU/RAM au-delà de 90 %, disque sous 20 % libres | 10 minutes | Identifier le service consommateur ; libérer les fichiers jetables |
| Disque/inodes sous 10 %, buffer vocal rejetant des événements | 10 minutes | Rétablir les écritures ; préserver base et événements en attente |
| Échecs de sauvegarde persistants | 1 heure depuis le premier échec non résolu | Lire `docker compose logs --tail=50 backup` ; reprise toutes les 15 minutes |
| Aucune archive, ou dernier succès au-delà de 26 heures | Condition maintenue 1 heure | Lancer `./backup.sh daily` et vérifier une archive complète |
| Restauration non vérifiée depuis 35 jours | 1 jour | Jouer la vérification mensuelle isolée |

Les notifications Discord indiquent la gravité, le symptôme, la zone concernée,
les détails de service/composant disponibles, le début, la première action et des
liens nommés vers Grafana et la procédure. À la résolution, elles indiquent la fin
sans répéter les consignes d'intervention : la condition d'alerte est levée, sans
garantir que sa cause a été vérifiée. Les horaires suivent le fuseau du lecteur
dans Discord. Les notifications regroupées présentent les alertes actives avant
les résolues ; un incident non résolu est rappelé toutes les quatre heures.
Après avoir recopié les fichiers de notification sur l'hôte, lancer
`docker compose restart grafana` depuis `deploy/` pour recharger le provisioning.
Un serveur calme ou une réplique de secours sans bail
est normal. Un rollout attendu ne demande pas de couper toutes les alertes.

```sh
docker compose ps
docker compose logs --tail=100 <service>
./backup.sh daily
./restore.sh verify ../backups/<dossier-snapshot> /chemin/vers/identite-age-privee
```

Vérifier une restauration chaque mois ; seul un succès sur la base isolée met à
jour sa date de vérification. Voir [Reprise après sinistre](./disaster_recovery).

La supervision partage l'hôte : elle ne notifie pas pendant sa panne complète,
ni lorsque Grafana ne peut plus envoyer de notifications. Cette version n'a pas
de sonde externe. L'historique du monitoring n'est pas nécessaire à la reprise.
