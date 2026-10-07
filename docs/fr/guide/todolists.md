# Todolists

Préparer un convoi, rassembler des caisses, répartir les tâches avant une opération : une todolist donne au groupe une
liste commune, directement dans Discord. Chaque tâche a un bouton ; les membres cliquent à mesure qu'ils avancent et
tout le monde voit la progression.

Vous pouvez regrouper les tâches par catégorie et indiquer des quantités. Quand toutes les tâches d'un message sont
terminées, PICKET le supprime : seules les pages qui demandent encore du travail restent dans le canal.

## Qui peut faire quoi ?

Les niveaux ci-dessous sont les accès **PICKET** configurés pour votre serveur, pas vos grades en jeu.

| Accès | Ce que vous pouvez faire |
| --- | --- |
| **Membre** | Créer une liste et cocher les tâches de toute liste du serveur à laquelle vous avez accès. |
| **Officier** | Tout ce qu'un membre peut faire, plus activer ou désactiver Todolists dans `/picket settings`. |
| **Administrateur Discord** | Tout ce qu'un officier peut faire, plus gérer les rôles d'accès et exporter ou supprimer les données du serveur. |

Par défaut, tous les membres du serveur peuvent utiliser les todolists. Un administrateur peut adapter les accès
dans `/picket settings` → **Permissions**. Consultez le [guide des permissions](./permissions) pour les détails.

Une liste appartient au groupe : **cocher n'est pas réservé à son créateur**, et il n'existe pas de permission propre
à chaque liste. Les droits Discord du canal et les rôles PICKET déterminent qui peut y participer.

## Votre première liste

1. Dans le canal où votre groupe s'organise, lancez **`/todolist create`**.
2. Remplissez le formulaire avec une tâche par ligne. Vous pouvez copier cet exemple :

   ```text
   __Préparation du convoi__
   A - Caisses de munitions (x3)
   A - Camions
   Rappel : départ à 21h
   ```

3. Validez : PICKET publie la liste, avec un bouton pour les caisses et un autre pour les camions.
4. Cliquez sur le bouton des caisses à chaque livraison : **3 → 2 → 1 → terminé**. Le bouton des camions demande un
   seul clic. Quand les deux tâches sont terminées, le message est supprimé.

Commencez chaque tâche par **`A - `** : une lettre majuscule, un tiret et une espace avant le texte. Vous pouvez
répéter `A -` sur toutes les lignes : PICKET attribue lui-même les lettres des boutons dans l'ordre des tâches.
Un tiret seul (`- Caisses`) reste du texte libre et ne crée pas de bouton.
**`__Préparation du convoi__`** crée un titre de catégorie ; une ligne comme `Rappel : départ à 21h` reste un rappel.

Le bot doit pouvoir **Voir le salon**, **Envoyer des messages** (ou **Envoyer des messages dans les fils**) et
**Intégrer des liens**. PICKET vous indique une permission manquante avant d'ouvrir le formulaire.

## Suivre le travail ensemble

Un clic coche une tâche ou retire une unité de sa quantité. Le message se met à jour pour tout le monde, sans message
de confirmation privé à chaque clic. À la fin d'une page, la personne qui termine reçoit une confirmation privée.
Si une tâche est déjà terminée lorsque vous cliquez, PICKET vous le signale.

Les clics simultanés sont pris en compte : deux personnes qui livrent une caisse chacune peuvent retirer deux unités.
Vous n'avez pas besoin d'attendre que l'autre personne ait fini de cliquer.

Une grande liste est répartie automatiquement sur plusieurs messages, avec un repère comme **📋 2/3**. Chaque page
se termine et se supprime indépendamment des autres. La confirmation indique la page terminée ; elle ne signifie pas
que toutes les pages de la liste sont finies. Les titres de catégorie sont répétés si une catégorie continue sur la
page suivante.

Un officier peut désactiver Todolists dans `/picket settings`. Les messages restent dans Discord, mais leurs boutons
ne fonctionnent plus tant que le module est désactivé. Les droits sont revérifiés à chaque clic.

## Organiser votre liste

### Catégories, quantités et rappels

Utilisez des titres pour séparer les étapes, et du texte libre pour les instructions qui n'ont pas besoin d'être
cochées :

```text
__Préparation__
A - Caisses (x2)
A - Camions
Rappel : briefing à 21h
__Combat__
A - Munitions
```

Le suffixe **`(x3)`** demande trois clics. `(x1)` disparaît car un clic suffit déjà. Les quantités `(x0)` ou supérieures
à 999 ne sont pas interprétées : elles restent dans le texte de la tâche.

Deux tâches de même texte dans la même catégorie sont fusionnées : `Caisses (x2)` et `Caisses` donnent
`Caisses (x3)`. Si leur somme dépasse 999, elles restent séparées. Le même texte dans deux catégories reste aussi
séparé. Les rappels et les titres restent à leur place.

::: details Autres formats de saisie acceptés

| Vous saisissez | Cela devient |
| --- | --- |
| `A - Caisses`, `A: Caisses`, `A・Caisses`, `A·Caisses` | Une tâche à cocher |
| `🇦 Caisses`, `🇦- Caisses`, `🇦: Caisses`, `:regional_indicator_a: - Caisses` | Une tâche à cocher |
| `__Préparation__`, `__**Préparation**__`, `**__Préparation__**` | Un titre de catégorie |
| `**Préparation**` suivi d'une tâche, éventuellement après des lignes vides | Un titre de catégorie |
| `Rappel : briefing à 21h`, `R-12 Hauler`, `**Info**` seul | Du texte libre |

Les lettres simples doivent être majuscules. Après une lettre simple, les séparateurs `-` et `:` demandent une espace
(`A - Caisses`, `A: Caisses`) : `R-12 Hauler` ou `A-10` restent du texte libre. La lettre saisie ne fixe pas le bouton :
PICKET attribue 🇦, 🇧, 🇨… dans l'ordre des tâches.

:::

## Limites

| Limite | Valeur |
| --- | --- |
| Texte saisi dans le formulaire | 4 000 caractères |
| Tâches par liste, après fusion | 100 |
| Texte d'une tâche | 300 caractères |
| Titre de catégorie reconnu | 100 caractères ; au-delà, la ligne reste du texte libre |
| Tâches par message | 25 au maximum ; moins si la taille du contenu l'impose |
| Quantité interprétée sur une tâche | De 1 à 999 |
| Nombre de listes par serveur | Pas de quota PICKET ; les limites de débit Discord s'appliquent |

PICKET ajoute les messages nécessaires pour afficher la liste. Une liste de 26 tâches demande donc au moins deux
messages ; elle ne demande pas une deuxième commande de création.

Une tâche cochée **ne peut pas être rouverte**, et une quantité ne peut que diminuer. Il n'y a pas d'éditeur pour
ajouter des tâches à une liste publiée : créez une nouvelle liste si vous devez revoir son contenu.

## Si quelque chose ne fonctionne pas

| Situation | Que faire ? |
| --- | --- |
| Le formulaire est refusé | PICKET indique la raison et vous renvoie le texte pour le recopier : vérifiez qu'il contient une tâche reconnue et respecte les limites. |
| Une ligne n'a pas de bouton | Utilisez par exemple `A - Caisses`, avec une lettre majuscule et une espace après le tiret. `- Caisses` seul reste du texte libre. |
| Vous ne pouvez pas créer une liste ou cliquer | Vérifiez vos rôles PICKET, l'activation de Todolists et les permissions Discord du canal. |
| Un clic est signalé comme temporairement occupé | Attendez un instant, puis réessayez. |
| Un message de liste a été supprimé manuellement | Son contenu et sa progression ne peuvent pas être restaurés par PICKET. Créez une nouvelle liste. |
| Une erreur apparaît pendant la publication, notamment après un arrêt du bot | Vérifiez d'abord le canal : des pages ont peut-être déjà été publiées. Évitez de créer des doublons en recommençant immédiatement. |

## Ce que PICKET stocke

**Le texte des tâches, les catégories, les rappels et la progression vivent dans les messages Discord.** PICKET ne les
enregistre pas dans sa base de données. Supprimer un message supprime donc cette page de la liste.

PICKET conserve toutefois des **métadonnées de création** : identifiants du serveur, du créateur, du canal et des
messages publiés, date de création et nombre de pages. Les journaux de fonctionnement peuvent aussi enregistrer
l'identifiant de la personne qui clique, celui du message, la position de la tâche et le résultat de l'action, sans
le contenu de la liste. **Ces journaux en base ont une rétention de 30 jours.**

Si un canal d'audit est configuré, PICKET y signale la **création de la liste**, avec un lien vers son message et le
nombre de pages, sans recopier les tâches. Les clics ne sont pas publiés dans ce canal. La rétention de 30 jours des
journaux ne supprime ni les listes ni les messages d'audit déjà publiés dans Discord.

Un administrateur peut exporter les données stockées ou demander leur suppression dans `/picket settings` →
**Données**. L'export contient les métadonnées et les journaux conservés, pas le contenu des listes hébergé dans
Discord. La suppression des données du bot ne supprime pas automatiquement ces messages. Consultez la
[Politique de confidentialité](../legal/privacy) pour le cadre général de conservation.
