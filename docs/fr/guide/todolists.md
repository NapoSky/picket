# Todolists

Une todolist est un message public du bot avec un bouton par item. Toute personne autorisée à utiliser PICKET clique sur
un bouton pour cocher l'item ; quand tout est fait, le message se supprime.

La liste **vit uniquement dans le message Discord** : PICKET n'en stocke rien dans sa base de données. Supprimer le
message supprime la liste.

## Créer une liste

Lancez `/todolist create` dans le canal où la liste doit apparaître, saisissez les items dans le formulaire, puis validez.
Le bot a besoin des permissions **Voir le salon**, **Envoyer des messages** (ou **Envoyer des messages dans les fils**) et
**Intégrer des liens** dans ce canal ; s'il en manque une, PICKET vous dit laquelle avant d'ouvrir le formulaire.

## Ce que vous pouvez saisir

| Vous saisissez | Cela devient |
| --- | --- |
| `A・Caisses`, `A·Caisses`, `A - Caisses`, `A: Caisses` (une lettre majuscule, puis `・`, `·`, `-` ou `:`) | Un item |
| `🇦 Caisses`, `🇦- Caisses`, `🇦: Caisses`, `:regional_indicator_a: - Caisses` | Un item |
| `__Préparation__`, `__**Préparation**__`, `**__Préparation__**` | Un titre de catégorie |
| `**Préparation**` suivi d'un item | Un titre de catégorie |
| Tout le reste (`Rappel : briefing à 21h`, `R-12 Hauler`, `**Info**` seul) | Du texte libre, conservé exactement là où vous l'avez écrit |

- La lettre saisie est ignorée : les items sont lettrés 🇦, 🇧, 🇨… dans l'ordre d'apparition.
- Après une lettre simple, `-` et `:` demandent une espace (`A - Caisses`, `A: Caisses`) ; `R-12 Hauler` ou `A-10` restent
  du texte libre.
- `Caisses (x3)` demande trois clics. `(x1)` est redondant et disparaît. `(x0)` et les quantités au-delà de 999 restent
  du texte.
- Deux items de même texte dans la même catégorie sont fusionnés et leurs quantités s'additionnent : `Caisses (x2)` et
  `Caisses` donnent `Caisses (x3)`. Le même texte dans deux catégories n'est pas fusionné.
- Le texte libre et les titres ne sont jamais déplacés, reformulés ni supprimés.

Exemple :

```text
__Préparation__
A・Caisses (x2)
B・Camions
Rappel : briefing à 21h
__Combat__
C・Munitions
```

## Limites

| Limite | Valeur |
| --- | --- |
| Texte | 4000 caractères |
| Items (après fusion) | 100 |
| Un item | 300 caractères |
| Items par message | 25 : les listes plus longues sont réparties sur plusieurs messages (`📋 2/3` en pied de page) |

Un texte sans item, avec trop d'items ou avec un item trop long est refusé avec la raison, et votre texte vous est renvoyé
pour pouvoir le recopier dans un nouveau formulaire. Une page qui deviendrait trop longue est commencée plus tôt : un
message ne dépasse jamais les limites de Discord, même une fois tous les items cochés.

Une liste répartie sur plusieurs messages répète le titre de catégorie en tête de chaque message qui commence au milieu de
cette catégorie.

## Utiliser une liste

- Cliquez sur un bouton pour cocher un item (ou retirer une unité de sa quantité). Le message se met à jour pour tout le
  monde ; vous ne recevez aucun message privé, sauf à la fin.
- Quand le dernier item d'un message est coché, le message est supprimé et vous savez quelle page est terminée. Dans une
  liste de plusieurs messages, chaque message est indépendant : PICKET n'affirme jamais que toute la liste est finie.
- Si deux personnes cliquent au même moment, **les deux clics comptent**, même traités par des instances différentes de
  PICKET. Si quelqu'un a déjà coché l'item, vous en êtes informé.
- Les boutons suivent le niveau d'accès **membre** au moment du clic, et la fonctionnalité `todolists` du serveur (voir
  [Commandes](./commands) et `/picket settings feature`). Désactiver la fonctionnalité arrête aussi les boutons des listes
  existantes.

## Limites connues

- Un item coché ne peut pas être rouvert et les quantités ne font que baisser. Créez une nouvelle liste : le message est
  la liste.
- Discord ne garde aucun historique de qui a coché quoi. L'opérateur d'une instance le retrouve dans les journaux de
  l'application (utilisateur, message, item), qui ne contiennent aucun contenu de liste.
- Toute personne du niveau membre peut cocher n'importe quel item ; il n'y a pas encore de permission par liste.
- PICKET ne limite pas le nombre de listes publiées par un serveur : les limites de débit de Discord s'appliquent.
- Si PICKET s'arrête pendant la publication d'une liste, le formulaire peut afficher une erreur ; vérifiez le canal avant de
  recommencer.
