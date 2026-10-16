---
aside: false
---

# Export et cycle de vie des données

Cette page décrit le fonctionnement de la version du code citée en bas de page. Elle permet à l'opérateur d'une
instance auto-hébergée de comprendre les données exportées et leur suppression. L'export général du serveur se trouve
dans **`/picket settings` → Données → Exporter** et nécessite le niveau administrateur.

Vous pouvez récupérer les réglages, les timers et les journaux encore conservés de votre serveur, ainsi qu’un
**résumé vocal sur 60 jours**. Les données d’usage expirent automatiquement selon leur nature : **7, 30 ou 60 jours**.
Vous pouvez aussi demander un effacement vocal ou programmer la suppression du serveur.

Une copie téléchargée reste sous votre contrôle. Les anciennes sauvegardes de PICKET disparaissent au plus tard après
30 jours ; elles ne contiennent pas l’historique vocal.

<ArchifyDiagram diagram="data-lifecycle" title="Données, export et fin de vie" />

<details>
<summary>Voir le contenu exact de l’export et les règles détaillées</summary>

## Ce que récupère l'export général

Le fichier est un JSON `picket.guild-data`, version `1`, avec `guildId`, `exportedAt`, `scope`, `notIncluded` et `data`.
Il contient un instantané cohérent des lignes du serveur encore conservées. Les logs sont vidés vers SQL et les
journaux de plus de 30 jours sont purgés avant sa lecture. L'export reste accessible pendant une suspension,
avant la purge définitive.

| Famille | Tables incluses, avec toutes leurs colonnes |
| --- | --- |
| Configuration et cycle de la guilde | `guild_settings`, `guild_registry`, `guild_support_presence`, `guild_permission_roles` |
| Audit et exploitation de la guilde | `guild_audit_log`, `guild_application_logs`, `guild_audit_delivery`, `guild_audit_schedule`, `interaction_receipts` |
| Timers | `timer_boards`, `timer_board_messages`, `timer_assets`, `timer_events`, `timer_alerts`, `timer_schedule` |
| War-log du serveur | `warlog_subscriptions`, `warlog_deliveries`, `warlog_hooks`, `warlog_hook_jobs`, `warlog_schedule` |
| Réglages Stats et opposition au suivi | `stats_settings`, `stats_privacy` |

Ces **22 tables** sont sélectionnées explicitement et filtrées par `guild_id` sous RLS. Les horodatages d'observation
de `stats_settings` sont masqués lorsqu'ils dépassent les 60 jours de rétention.

Deux collections dérivées complètent les lignes SQL :

| Collection | Champs et sens |
| --- | --- |
| `stats_members` | `userId`, `username`, `totalSeconds`, `lastActivityDate`, `pendingEvents`, `lastPendingActivityDate` : synthèse par membre sur les 60 derniers jours. |
| `stats_summary` | `retentionDays` (60), `members`, `totalSeconds`, `pendingEvents` : synthèse du serveur. |

Les événements vocaux en attente sur disque sont capturés avant l'instantané SQL, limités à 60 jours et dédupliqués
contre les événements déjà enregistrés. Ils alimentent les compteurs d'attente ; leur durée n'est pas ajoutée avant
leur traitement.

Le fichier est fabriqué en mémoire et envoyé comme pièce jointe privée. PICKET n'en garde aucune copie. Sa limite est
le minimum entre **10 MiB** et la limite de pièce jointe Discord : si elle est dépassée, l'export échoue sans produire
de fichier partiel. La copie téléchargée dépend ensuite de la politique de son destinataire.

## Ce qui n'est pas joint

| Données | Où elles vivent et pourquoi elles sont exclues |
| --- | --- |
| Contenu des todolists et messages Discord | Dans Discord. Lecture temporaire pour une création ou un clic ; pas de copie du contenu dans PostgreSQL. Les actions peuvent produire des logs de guilde sans contenu. |
| Événements et segments vocaux bruts, état connecté, pseudos/salons internes et journal disque | Sources internes des synthèses ; leurs lignes ne sont pas jointes à l'export général. |
| Instantanés admin Stats | Modèles privés reconstruits à partir des segments ; exclus de l'export général et des sauvegardes standard. |
| Sessions du dashboard et états OAuth | Identité et tokens chiffrés d'authentification ; exclus de l'export et des sauvegardes standard. |
| État public Foxhole partagé | Guerres, objets, événements et timers de béton globaux ; aucune donnée de membre Discord. L'export contient les abonnements/livraisons propres au serveur. |
| État applicatif global et coordination | Leases, verrous, sessions Gateway et budgets REST ; hors export de guilde. |
| Administration privée du service | Sessions et historique des retraits opérateur, motifs internes compris : données d’instance hors export de guilde. |
| Secrets et diagnostics opérationnels | Secrets hors des tables exportées ; diagnostics assainis séparés des logs de guilde, sans identifiants Discord ni contenu utilisateur. |

Les exports d'activité **`/stats export`** et du dashboard sont des rapports CSV/JSON de statistiques accessibles selon
le périmètre de l'utilisateur. Leur contrat est distinct de l'export général ci-dessus : voir [statistiques vocales](../guide/stats).

## Suppression automatique

| Données | Déclencheur et traitement |
| --- | --- |
| Reçus d'interaction | Suppression après 7 jours. Ils servent uniquement à éviter les doublons. |
| Sessions et retraits opérateur privés | Sessions expirées après dix minutes ; confirmations non envoyées après au plus deux minutes. L’historique des opérations terminées expire après 30 jours, indépendamment de la purge des guildes. Les demandes non résolues restent pour réconciliation. Nettoyage toutes les 15 secondes par le job-runner ; les notifications Discord restent dans leur salon privé. |
| Audit, événements de timers, logs applicatifs de guilde | Suppression après 30 jours fixes, même si le serveur reste actif. |
| Activité vocale SQL et métadonnées des participants/salons | Fenêtre glissante de 60 jours. Les rapports appliquent la borne à la lecture ; maintenance SQL toutes les deux minutes, par lots. Les segments qui traversent la borne sont tronqués. |
| Journal vocal disque | Les événements expirent après 60 jours ; nettoyage sous verrou. Les événements rejoués avec succès sont retirés du buffer. Les marqueurs d'effacement expirent aussi après 60 jours. |
| Présence connectée | Retirée à la déconnexion ou à l'exclusion ; également soumise au nettoyage de rétention. |
| Timers expirés ou barrés | Supprimés après `purgeAfterHours` : 24 heures par défaut, délai configurable ou désactivable. |
| Tableaux de timers vides et inactifs | Supprimés après 30 jours sans activité. Les messages sont nettoyés si Discord le permet. |
| Alertes de timers | Messages retirés après échéance, rafraîchissement, suppression ou remplacement par un seuil plus proche. |
| Livraisons du war-log | Nettoyage pendant la collecte des livraisons terminées depuis plus d'un jour et de celles d'une génération ou guerre obsolète. |
| Historique public Foxhole | Conservation des deux guerres observées les plus récentes ; nettoyage pendant la collecte. |
| Sessions du dashboard / états OAuth | Expiration de session : huit heures maximum, ou durée du token si plus courte. État OAuth : dix minutes. Nettoyage lors de la maintenance Stats. |
| Diagnostics et métriques | Loki : 30 jours ; Prometheus : 30 jours ou 5 Go. Logs Docker : rotation par taille (`10m` × 3 fichiers par conteneur durci). |
| Sauvegardes standard | Cinq archives au plus, aucune de plus de 30 jours ; rotation et suppression exécutées par le service de sauvegarde. |

Le job quotidien à **03:00 dans `TZ`** (Europe/Paris par défaut) purge reçus, journaux et guildes arrivées à échéance.
Il rattrape une échéance manquée et retente les échecs. Les maintenances de timers, Stats, buffer et war-log ont leurs
propres déclencheurs. Une panne peut retarder le nettoyage physique ; les lectures Stats gardent la borne de 60 jours.

## Retrait du bot et suppression du serveur

Après le retrait du bot, la guilde devient inactive et ses données restent pendant **`GUILD_RETENTION_DAYS`**
(30 jours par défaut). Le retour du bot avant la purge réactive les données lorsqu'il s'agissait d'un retrait.

Un retrait confirmé par un administrateur fait quitter le serveur à PICKET et programme immédiatement la suppression
à l’échéance annoncée. Pour l’annuler avant cette échéance, réinvitez PICKET, puis **annulez explicitement la suppression**
dans `/picket settings` → Données en tant qu’administrateur du serveur. Une reconnexion Gateway ou le retour du bot
ne suffit pas à annuler cette demande.

À échéance, la purge efface d'abord les événements disque et marqueurs de la guilde, puis toutes les lignes SQL
portant son `guild_id`, registre et audits compris. Un échec disque conserve le registre pour permettre une nouvelle
tentative. Les données publiques Foxhole partagées ne portent pas ce périmètre et suivent leur propre rétention.

## Refus du suivi et effacement individuel

Le refus dans `/stats privacy` ou le dashboard arrête la collecte future et ferme la présence courante ; il ne
supprime pas à lui seul l'historique déjà conservé. Une demande d'effacement supprime les faits vocaux et le pseudo
SQL ainsi que les événements disque en attente. Les préférences de suivi et bornes `erased_before` sont conservées
pour empêcher un rejeu tardif de réintroduire l'activité effacée.

Les instantanés admin sont immédiatement invalidés : les résultats concernés sont inaccessibles jusqu'à leur
reconstruction. Leur nettoyage physique suit le rafraîchissement. La purge quotidienne invalide aussi les instantanés.

## Sauvegardes et copies hors de l'instance

La sauvegarde standard chiffre directement le dump PostgreSQL avec age. Elle conserve la configuration Stats et les
préférences de confidentialité, mais exclut les événements/segments/présences vocaux, pseudos, salons, instantanés admin,
sessions web et états OAuth. Elle ne copie pas le volume `voice-buffer`. Une restauration standard ne rétablit donc pas
l'historique vocal effacé.

Les autres données peuvent subsister dans une archive antérieure à leur suppression jusqu'à sa rotation (30 jours au
plus). Les copies que l'opérateur transfère ailleurs, les messages Discord et les exports téléchargés doivent être
gérés dans leur propre périmètre. Voir [reprise après sinistre](./disaster_recovery).

Sources : [export SQL](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/packages/guild/src/infrastructure/postgres-guild-data-export-repository.ts),
[format JSON](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/packages/guild/src/application/export-guild-data.ts),
[rétention](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/apps/bot/src/composition.ts),
[maintenance Stats](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/packages/stats/src/infrastructure/postgres-stats-store.ts) et
[sauvegarde](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/deploy/backup/run.sh).

</details>

Pour les vocaux éphémères, l’export serveur inclut uniquement les noms des modèles actuels. Options, préparations privées, présence opérationnelle, identifiants des canaux et état de vérification/nettoyage sont exclus. Voir [Vocaux éphémères](../guide/voice).
