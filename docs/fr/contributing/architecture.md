# Architecture

PICKET est un monolithe modulaire dans un workspace pnpm : une image, plusieurs réplicas identiques, PostgreSQL comme
unique source de vérité.

```text
apps/bot            composition du bot : interactions, Gateway, jobs et CLI
apps/stats          processus HTTP du dashboard isolé et pool SQL borné
packages/kernel     identifiants, Result, Clock, Logger, Secret
packages/config     validation de l'environnement
packages/i18n       traductions, résolution de langue, contrôle des catalogues
packages/persistence  accès à la base, migrations, sécurité par ligne
packages/coordination baux avec fencing, verrous par clé, stockage des sessions Gateway
packages/discord    pipeline d'interactions, registres de commandes et de composants, adaptateurs HTTP et Gateway, ports REST
packages/guild      serveurs : réglages, permissions, cycle de vie
packages/game-data  régions et lieux du jeu, et la recherche derrière l'autocomplétion
packages/todolist   todolists : grammaire, rendu, cochage (l'état vit dans le message Discord)
packages/timers     tableaux de timers : état en base, rendu pur, alertes, entretien des tableaux
packages/warlog     collecteur partagé, état public, abonnements et livraisons par serveur
packages/testing    outils partagés par les tests
```

## Couches

Chaque package fonctionnel est découpé en `domain/`, `application/`, `infrastructure/` et `presentation/`. Les
dépendances ne vont que vers l'intérieur. Un test (`tests/architecture`) fait échouer le build quand `domain/` ou
`application/` importe Discord, la base, HTTP ou des modules Node, quand un package va chercher dans un autre au lieu de
son API publique, ou quand du code hors de `@picket/config` lit `process.env`.

## Règles à connaître

- **Un serveur est un tenant.** Toute table qui contient des données de serveur a une colonne `guild_id` et une sécurité
  par ligne qui lit `app.guild_id` ; le code y accède par `withTenant`. Un test échoue si une telle table n'a pas la
  politique. L'application se connecte avec un rôle qui ne possède rien et ne peut pas contourner la politique.
- **Idempotence.** Les interactions sont réclamées une seule fois entre les réplicas ; les écritures utilisent des clés
  naturelles et des mises à jour conditionnelles.
- **Les singletons utilisent des baux.** Un travail qui ne doit tourner qu'une fois (un shard Gateway, les tâches
  périodiques) est tenu par un bail avec jeton de fencing, vérifié par les écritures du détenteur.
- **La base est la vérité, Discord n'est qu'une vue.** Les timers gardent leur état dans PostgreSQL et le rendent par une
  fonction pure (le même état donne toujours les mêmes messages, comparés par empreinte). Un changement et le rendu qu'il
  appelle sont écrits dans la même transaction : un arrêt entre les deux est réparé par le planificateur. Un rendu lit
  l'état le plus récent sous un verrou par tableau, et une rafale de changements partage un seul rendu.
- **Mises à jour sans interruption.** Les migrations ne font qu'ajouter ; les charges utiles et identifiants qui
  traversent les versions sont versionnés.
- **Les commandes sont déclarées une fois.** Le registre valide noms, options et textes au démarrage et génère le JSON
  envoyé à Discord. Chaque commande déclare explicitement son niveau requis.

## Ajouter une commande

1. Ajoutez les textes dans `packages/i18n/locales/en.json` et traduisez-les dans chaque catalogue livré, puis lancez `pnpm i18n:keys`.
2. Écrivez le cas d'usage dans la couche `application/`, avec un port pour ce dont il a besoin.
3. Ajoutez l'adaptateur dans `infrastructure/` et la commande dans `presentation/discord/` (niveau, options, handler
   utilisant `t`).
4. Enregistrez-la dans `apps/bot/src/composition.ts`.
5. Testez-la : tests unitaires avec des doublures en mémoire, et un test d'intégration sur PostgreSQL si elle touche aux
   données.

## Ajouter un bouton ou un formulaire

1. Déclarez une `ComponentFamily` : un espace de noms (`td`), une version, le niveau requis, et la fonctionnalité du serveur
   dont elle dépend.
2. Construisez les identifiants avec `encodeCustomId` (`espace:version:charge`, 100 caractères au plus). Un nouveau format
   demande une nouvelle version : les anciens boutons reçoivent une réponse « expiré », jamais le silence.
3. Enregistrez la famille dans `apps/bot/src/composition.ts`. Boutons et formulaires passent par la même chaîne que les
   commandes : doublons, niveau d'accès, fonctionnalité, suspension, langue, erreurs.
4. Renvoyez `{ kind: 'deferred', ... }` pour tout ce qui parle à Discord : le pipeline accuse réception sous 3 secondes,
   exécute le travail ensuite et livre le résultat ; l'arrêt d'une réplique l'attend.

## Tests

```sh
pnpm test          # typecheck + tests unitaires (rapide, sans Docker)
pnpm test:int      # tests d'intégration sur un PostgreSQL jetable (nécessite Docker)
pnpm test:all      # les deux
```

Démarrez Docker Engine ou Docker Desktop avant les tests d'intégration, puis vérifiez que `docker info` fonctionne.
Testcontainers démarre PostgreSQL 18 (`postgres:18-alpine`), crée des bases isolées, applique les migrations et se connecte
avec le rôle applicatif soumis à la sécurité par ligne. Les tests n'utilisent ni votre base de développement ni vos
identifiants Discord. Les bases de test et le conteneur sont supprimés à la fin de l'exécution.

Les tests d'intégration du panneau serveur couvrent les interactions HTTP signées, sélections natives et modales,
changements immédiats de langue et permissions, audits, isolation des serveurs, alias de transition, confirmation de
suppression, récupération après expiration du panneau et échéance de rétention. Les tests Gateway vérifient aussi que
la reconnexion du bot n'annule pas une suppression demandée depuis le panneau. Messages et réponses Discord utilisent
des doublures : la vérification visuelle sur ordinateur et mobile nécessite encore une application Discord de développement.

Validation du 2026-10-07 : les 176 tests d'intégration (12 suites) et les 702 tests unitaires (44 suites) passent.
La vérification TypeScript et la compilation de la documentation FR/EN passent également.

La chaîne d'outils est TypeScript 7 (`tsc`), Jest avec `@swc/jest`, et pas de linter : le test d'architecture et le mode
strict du compilateur font ce travail.

## Panneau serveur

`/picket settings` utilise les composants V2 ; les tableaux et todolists conservent leurs embeds existants. Les modèles du panneau sont indépendants des types Discord. Une réponse `panel` actualise le message original après un accusé différé ; les erreurs peuvent être livrées en suivi privé.

Chaque bouton ou menu possède un `custom_id` unique dans le message, y compris lorsque plusieurs boutons mènent au même écran. La navigation, l’actualisation et l’annulation utilisent des actions distinctes. L’adaptateur vérifie l’unicité et la longueur des identifiants avant l’envoi : un doublon est rejeté par Discord avec l’erreur `50035` (corps invalide). Les tests de parcours valident aussi la conversion des panneaux vers le format Discord.

Les familles séparent navigation, réglages officier, permissions administrateur, suppression et annulation. Seules la navigation en lecture et l’annulation sont disponibles pendant une suspension. Les identifiants contiennent propriétaire, guilde et échéance ; aucun collecteur ni stockage de session n’est nécessaire. Les droits sont revérifiés avant le travail différé et les use cases modifient l’état courant en transaction.

Le registre accepte des alias de transition non publiés. Déployer toutes les répliques avant `deploy-commands` : les anciens chemins ouvrent le panneau sans appliquer leurs arguments. Retirer ces alias lors d’une version ultérieure. Pour revenir en arrière, restaurer ensemble le code et les définitions de commandes ; aucun schéma de données n’a changé. Surveiller les refus d’accès, composants expirés et erreurs de livraison Discord dans les journaux existants.

## Statistiques vocales

`packages/stats` gère les faits vocaux horodatés, segments par salon, reprise disque, confidentialité et dashboard Fastify facultatif. La collecte partage les shards Gateway ; seuls les rôles cibles produisent de l’historique. La RLS impose les accès personnels/guilde/globaux sans compte BYPASSRLS. Le contexte global exige une vérification de la Team Discord. Les sessions OAuth sont partagées dans PostgreSQL, les tokens chiffrés avec le secret client de l’application. Le frontend sans bundler emploie les assets PICKET, des fichiers JS/CSS externes, textes EN/FR et graphiques SVG ; aucun framework UI ou service BI supplémentaire. Le runtime HTTP de production est composé dans `apps/stats`, un processus/conteneur Node.js distinct. Ses lectures utilisent un seul pool borné ; il ne lance ni collecte ni jobs du bot. Les deux services partagent PostgreSQL et le tampon disque pour la confidentialité et l’effacement, avec santé et mises à jour indépendantes. Les rapports membre/guilde dérivent leurs agrégats des segments conservés. Les rapports admin globaux lisent les vues matérialisées privées de la migration `014_stats_admin_snapshot`, via des fonctions exigeant le contexte global de confiance. Le rôle applicatif ne peut pas lire directement leurs lignes.

La vue globale PICKET partage avec les utilisateurs connectés le nombre actuel de guildes actives et les effectifs
par fonctionnalité activée. La migration `013_instance_overview` fournit une fonction SQL sans paramètre qui renvoie
uniquement ces agrégats, avec un chemin de recherche fixé et un droit d'exécution accordé au rôle applicatif. Sa politique
de lecture réservée au propriétaire de migration préserve l'isolation des tenants pour l'application. Aucun identifiant,
nom ou réglage individuel de guilde n'est renvoyé, et aucun historique d'agrégat n'est conservé. Les accès vocaux restent
limités aux périmètres personnel, guilde et Team.

### Charge vocale reproductible

`pnpm stats:test:load` crée 300 guildes, 50 personnes suivies distinctes par guilde, 60 jours et huit segments fermés
par personne/jour : **7 200 000 segments**, avec reconnexions, changements de salon et deux salons. Il rapproche les
totaux, séries quotidiennes par serveur, personnes distinctes, durées horaires et pics de présence. La réponse inclut
la première page de membres et les présences récentes, comme le dashboard admin. Vingt confirmations du pool principal
s'exécutent en parallèle, avec quatre connexions principales et deux dashboard. La passe d'intégration habituelle utilise
un fixture réduit de 300 guildes, dix personnes et deux segments quotidiens. `STATS_LOAD_PEOPLE` (1–200) et
`STATS_LOAD_SEGMENTS` (1–48) ajustent le profil de test sans limiter la collecte. Les faits synthétiques mesurent les
lectures et la contention des confirmations, pas le débit complet du Gateway ; les événements bruts et autres tables
ne sont pas compris dans la taille des segments. Les mesures sont écrites dans le dossier temporaire système sous
`picket-stats-benchmark.json`.

Le passage étendu mesure environ **2,0 s au p95 par guilde**, **48,5 s pour le calcul global depuis les
segments**, et **9,1 s pour le rapport admin matérialisé** (maximum de trois lectures). Le premier rafraîchissement
prend **179 s**, le suivant avec CONCURRENTLY **195 s**. Une lecture admin pendant ce second rafraîchissement prend
**9,2 s** ; les confirmations principales réellement lancées pendant le rafraîchissement restent à **53 ms au p95**.
Les segments et index occupent **3 128 MB**, les vues et leurs index **1 095 MB** supplémentaires. Ces mesures dépendent
du matériel et du cache ; elles ne garantissent pas ce délai en production. Le test borne les lectures admin après
rafraîchissement à 15 secondes et distingue le coût du calcul en arrière-plan de la consultation.

Les instructions SQL globales ont un délai maximal de 30 secondes ; les lectures de guilde et personnelles gardent
10 secondes, avec une seconde d'attente de verrou. Les lectures quotidiennes découpent seulement les jours traversés
et regroupent d'abord les segments répétés par personne/jour avant de dédupliquer entre guildes. Les lectures horaires
UTC utilisent des tranches d'une heure ; les autres fuseaux gardent quinze minutes pour les changements d'heure et de
décalage. Les agrégats membre/guilde restent calculés à la lecture. Les contributions quotidiennes admin gardent les identités membre/guilde/salon et les bornes exactes ; totaux horaires et pics de simultanéité sont matérialisés séparément. Les personnes sont dédupliquées entre jours et guildes. La première alimentation utilise REFRESH ; les suivantes utilisent CONCURRENTLY dans une transaction REPEATABLE READ, avec verrou consultatif. Le job-runner vérifie chaque minute `STATS_ADMIN_REFRESH_CRON` (défaut `0 0,12 * * *`) dans `TZ` (défaut Europe/Paris), rattrape les échéances manquées et retente les échecs. La rétention quotidienne reste à 03h, désormais dans ce même fuseau. Effacement/purge incrémente une révision transactionnelle : les lectures globales refusent un instantané obsolète jusqu’à publication d’une révision concordante. Un effacement concurrent fait échouer la publication plutôt que de réintroduire les contributions. Les lectures bornent exactement les 60 jours actuels, indépendamment de l’âge de l’instantané. La rétention quotidienne invalide aussi l’instantané. Les sauvegardes excluent les données matérialisées et leur état ; le worker les réinitialise après restauration.

L'export général du serveur inclut les réglages Stats, préférences de suivi, synthèses `stats_members` et vue
`stats_summary` sur 60 jours. Les faits disque sont capturés avant l'instantané SQL, dédupliqués contre les clés déjà
écrites et résumés par membre ; leur durée n'est pas créditée avant traitement. Les événements bruts, segments, états
connectés et entrées du journal ne sont pas joints au fichier. La purge d'une guilde efface le disque et ses marqueurs
avant la suppression SQL ; un échec disque laisse le registre disponible pour réessayer. Le CLI utilise le même chemin
et volume partagé. Les droits combinent identité et permissions Discord avec les rôles PICKET actuels en PostgreSQL ;
une requête forgée ne peut pas élargir l'accès. La Team propriétaire conserve le périmètre global convenu.

`pnpm stats:dev` utilise Vite pour l’aperçu local et le rechargement du navigateur, avec le vrai dashboard et des données fictives isolées sur localhost par défaut (`--host` / `--port` sont les options natives de Vite) ; `pnpm stats:dev:live admin --host` lance le processus HTTP dédié sur le vrai PostgreSQL local, avec une identité Discord simulée, les valeurs par défaut de `.env.example` et les paramètres de `.env.dev`. La préparation réutilise `compose.dev.yml` et applique les migrations. Le point d’entrée de production refuse la simulation ; `pnpm stats:dev:oauth` permet de tester le vrai OAuth. Lancez le bot séparément. `pnpm stats:test` et `pnpm stats:test:int` sélectionnent explicitement les tests de la feature. Les exports web et Discord partagent le même contrat : tableau JSON à plat ou lignes CSV, avec identification de la guilde en export global. Voir `SELF_HOSTING.md`, section développement des stats, pour la configuration.
