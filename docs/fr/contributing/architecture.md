# Architecture

PICKET est un monolithe modulaire dans un workspace pnpm : une image, plusieurs réplicas identiques, PostgreSQL comme
unique source de vérité.

```text
apps/bot            racine de composition : serveur HTTP, runner Gateway, ligne de commande
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
