---
aside: false
---

# Export et cycle de vie des données

Cette page explique ce que PICKET conserve pour un serveur Discord, ce que son export restitue et ce qui provoque
la suppression des données. Elle décrit la version du code citée en bas de page.

L’export général se demande dans **`/picket settings` → Données → Exporter**, en tant qu’administrateur du serveur.
Il contient les réglages, les timers et les journaux encore conservés, les noms des modèles de vocaux éphémères et
un **résumé vocal sur 60 jours**. Certaines informations sont synthétisées ou volontairement exclues.

Les données d’usage expirent selon leur nature. Un membre peut arrêter son suivi vocal ou demander un effacement ;
un administrateur peut programmer la suppression des données du serveur. Une copie téléchargée reste sous le
contrôle de son destinataire.

<ArchifyDiagram diagram="data-lifecycle" title="Vue d’ensemble : données, export et fin de vie" />

<details>
<summary>Comprendre le contenu de mon export</summary>

## Données conservées et contenu exporté

Le diagramme compare les données en base rattachées à votre serveur avec leur restitution dans le fichier.
Les membres et salons observés appartiennent à ce périmètre. Les données conservées uniquement dans Discord
et les informations globales de l’instance ne font pas partie de cet inventaire.

<ArchifyDiagram diagram="guild-data-export" title="Données du serveur : inclusions, synthèses et exclusions" />

| Famille | Ce que PICKET conserve pour votre serveur | Dans l’export général |
| --- | --- | --- |
| Réglages et accès | Nom et identifiant Discord du serveur, langue, fuseau horaire, fonctions activées, rôles autorisés, salon d’audit, réglages Stats et préférences individuelles de suivi. | Réglages et préférences conservés, ainsi que l’état actif/inactif du serveur. |
| Timers et war-log | Tableaux, objets et échéances suivis, responsables, salons et messages associés, alertes, abonnements et suivi des notifications. | Données encore conservées, y compris le suivi des notifications. |
| Vocaux éphémères | Modèles et options : catégorie de destination, noms des salons, capacité et délai d’inactivité. Préparations privées, salons créés, présence et suivi du nettoyage. | **Noms des modèles actuels uniquement.** Options et données de fonctionnement exclues. |
| Activité vocale | Identifiants Discord et pseudos des membres observés, noms et identifiants des salons vocaux observés, arrivées/départs, périodes de présence, rôles associés et synthèses privées. | **Synthèse par membre** : identité, durée cumulée et dernière activité sur 60 jours, plus un résumé du serveur. Historique détaillé, présence connectée et liste des salons observés exclus. |
| Journaux et suivi | Actions d’administration avec leur auteur, traces d’utilisation, reçus contre les doublons et suivi des messages d’audit. État interne des demandes de départ du bot. | Journaux, reçus et suivi d’audit encore conservés. **Demandes de départ internes exclues.** |

Des compteurs d’événements vocaux en attente d’enregistrement complètent les synthèses. Ils proviennent du journal
disque ; leur durée n’est pas ajoutée aux totaux avant traitement.

PICKET fabrique le fichier en mémoire et le remet en privé, sans en garder de copie. L’export reste disponible
pendant une suspension, avant la purge définitive. Il représente les données encore conservées au moment de la
demande ; il ne constitue pas une sauvegarde permettant de tout restaurer.

Les exports d’activité **`/stats export`** et du dashboard sont des rapports statistiques distincts de cet export
général : voir [statistiques vocales](../guide/stats). Voir aussi [vocaux éphémères](../guide/voice).

<details>
<summary>Référence technique : format, tables et limites de l’export</summary>

### Format et contenu exact

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

Les noms des modèles actuels de vocaux éphémères sont ajoutés dans `voice_templates`, avec uniquement le champ
`name`. Les autres colonnes de cette table sont exclues.

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

### Ce qui n'est pas joint

| Données | Où elles vivent et pourquoi elles sont exclues |
| --- | --- |
| Contenu des todolists et messages Discord | Dans Discord. Lecture temporaire pour une création ou un clic ; pas de copie du contenu dans PostgreSQL. Les actions peuvent produire des logs de guilde sans contenu. |
| Événements et segments vocaux bruts, état connecté, pseudos/salons internes et journal disque | Sources internes des synthèses ; leurs lignes ne sont pas jointes à l'export général. |
| Options et suivi des vocaux éphémères | Options des modèles, limite de déploiement, préparations privées, salons créés, présence et état de vérification/nettoyage. Seuls les noms des modèles sont joints. |
| Demandes de départ du bot | État interne utilisé pour exécuter ou réconcilier le retrait ; exclu. Le registre actif/inactif et les traces d’audit sont exportés. |
| Instantanés admin Stats | Modèles privés reconstruits à partir des segments ; exclus de l'export général et des sauvegardes standard. |
| Sessions du dashboard et états OAuth | Identité et tokens chiffrés d'authentification ; exclus de l'export et des sauvegardes standard. |
| État public Foxhole partagé | Guerres, objets, événements et timers de béton globaux ; aucune donnée de membre Discord. L'export contient les abonnements/livraisons propres au serveur. |
| État applicatif global et coordination | Leases, verrous, sessions Gateway et budgets REST ; hors export de guilde. |
| Administration privée du service | Sessions et historique des retraits opérateur, motifs internes compris : données d’instance hors export de guilde. |
| Secrets et diagnostics opérationnels | Secrets hors des tables exportées ; diagnostics assainis séparés des logs de guilde, sans identifiants Discord ni contenu utilisateur. |

</details>

</details>

<details>
<summary>Comprendre la conservation et l’effacement</summary>

## Ce qui conserve ou efface les données

Les déclencheurs ci-dessous n’ont pas tous le même effet : une expiration nettoie les données concernées,
un refus du suivi arrête la collecte future et une purge du serveur retire l’ensemble de ses données en base.

<ArchifyDiagram diagram="guild-data-retention" title="Conservation et effacement : déclencheurs et conséquences" />

### Retrait du bot et suppression du serveur

Après le retrait du bot, la guilde devient inactive et ses données restent pendant **le délai de rétention de l’instance**
(30 jours par défaut). Le retour du bot avant la purge réactive les données lorsqu'il s'agissait d'un retrait.

Un retrait confirmé par un administrateur fait quitter le serveur à PICKET et programme immédiatement la suppression
à l’échéance annoncée. Pour l’annuler avant cette échéance, réinvitez PICKET, puis **annulez explicitement la suppression**
dans `/picket settings` → Données en tant qu’administrateur du serveur. Une reconnexion Gateway ou le retour du bot
ne suffit pas à annuler cette demande.

À échéance, la purge efface d'abord les événements disque et marqueurs de la guilde, puis les données en base
rattachées au serveur, registre et audits compris. Un échec disque conserve le registre pour permettre une nouvelle
tentative. Les données publiques Foxhole partagées ne portent pas ce périmètre et suivent leur propre rétention.

### Refus du suivi et effacement individuel

Le refus dans `/stats privacy` ou le dashboard arrête la collecte future et ferme la présence courante ; il ne
supprime pas à lui seul l'historique déjà conservé. Une demande d'effacement supprime l’activité vocale et le pseudo
en base ainsi que les événements disque en attente. L’identifiant Discord du membre, ses préférences de suivi et
une date de protection sont conservés pour empêcher le retour d’anciennes observations déjà effacées.

Les instantanés admin sont immédiatement invalidés : les résultats concernés sont inaccessibles jusqu'à leur
reconstruction. Leur nettoyage physique suit le rafraîchissement. La purge quotidienne invalide aussi les instantanés.

Les rétentions habituelles continuent pendant l’attente de purge. Le retour du bot réactive les données qui
restent ; il ne restaure pas celles qui ont déjà expiré. Effacer son activité ne bloque pas à lui seul les
collectes futures : elles dépendent du choix de suivi du membre.

<details>
<summary>Durées exactes et exécution des nettoyages</summary>

Les règles ci-dessous précisent les durées par type de donnée. Elles couvrent aussi les traitements de l’instance
qui dépassent le périmètre des données en base d’un seul serveur.

Le délai de purge d’un serveur inactif se configure avec `GUILD_RETENTION_DAYS` : 30 jours par défaut.

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
| Préparations privées de vocaux éphémères | Expiration 15 minutes après leur dernier renouvellement, puis suppression par le nettoyage. |
| Suivi des vocaux éphémères | Les suivis de salons supprimés ou en échec sont nettoyés après un jour ; les présences devenues sans objet sont retirées. Les modèles et options ne suivent pas ce délai. |
| Alertes de timers | Messages retirés après échéance, rafraîchissement, suppression ou remplacement par un seuil plus proche. |
| Livraisons du war-log | Nettoyage pendant la collecte des livraisons terminées depuis plus d'un jour et de celles d'une génération ou guerre obsolète. |
| Historique public Foxhole | Conservation des deux guerres observées les plus récentes ; nettoyage pendant la collecte. |
| Sessions du dashboard / états OAuth | Expiration de session : huit heures maximum, ou durée du token si plus courte. État OAuth : dix minutes. Nettoyage lors de la maintenance Stats. |
| Diagnostics et métriques | Loki : 30 jours ; Prometheus : 30 jours ou 5 Go. Logs Docker : rotation par taille (`10m` × 3 fichiers par conteneur durci). |
| Sauvegardes standard | Cinq archives au plus, aucune de plus de 30 jours ; rotation et suppression exécutées par le service de sauvegarde. |

Le job quotidien à **03:00 dans `TZ`** (Europe/Paris par défaut) purge reçus, journaux et guildes arrivées à échéance.
Il rattrape une échéance manquée et retente les échecs. Les maintenances de timers, Stats, buffer et war-log ont leurs
propres déclencheurs. Une panne peut retarder le nettoyage physique ; les lectures Stats gardent la borne de 60 jours.

</details>

</details>

## Sauvegardes et copies hors de l’instance

La sauvegarde standard chiffre directement le dump PostgreSQL avec age. Elle conserve la configuration Stats et les
préférences de confidentialité, mais exclut l’historique et les métadonnées Stats : événements, périodes, présences,
pseudos et salons observés. Les instantanés admin, sessions web et états OAuth sont aussi exclus. Elle ne copie pas
le volume `voice-buffer`. Une restauration standard ne rétablit donc pas l'historique vocal effacé.

Les autres données peuvent subsister dans une archive antérieure à leur suppression jusqu'à sa rotation (30 jours au
plus). Les copies que l'opérateur transfère ailleurs, les messages Discord et les exports téléchargés doivent être
gérés dans leur propre périmètre. Voir [reprise après sinistre](./disaster_recovery).

<details>
<summary>Sources de l’implémentation</summary>

Sources : [export SQL](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/guild/src/infrastructure/postgres-guild-data-export-repository.ts),
[format JSON](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/guild/src/application/export-guild-data.ts),
[rétention](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/apps/bot/src/composition.ts),
[maintenance Stats](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/stats/src/infrastructure/postgres-stats-store.ts) et
[sauvegarde](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/deploy/backup/run.sh).

[Vocaux éphémères](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/persistence/migrations/020_ephemeral_voice.sql),
[synthèses privées Stats](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/persistence/migrations/014_stats_admin_snapshot.sql) et
[cycle du serveur](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/guild/src/application/guild-events-use-cases.ts).

</details>
