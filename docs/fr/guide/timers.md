# Timers

Un tableau de timers est un message, dans un canal, qui liste les ressources que votre régiment doit surveiller
(stockpiles, installations, champs, navires, chars, trains), chacune avec son compte à rebours et un bouton pour le
remettre à zéro. PICKET vous prévient avant la fin d'un compte à rebours.

## Mettre en place un tableau

Un officier lance `/timers create` dans le canal qui doit accueillir le tableau. Le bot y a besoin de **Voir le
salon**, **Envoyer des messages** (ou **Envoyer des messages dans les fils**) et **Intégrer des liens** ; PICKET vous dit
laquelle manque. Un canal a un seul tableau, et un serveur peut en avoir 10 au plus. Si le canal en a déjà un (par exemple parce que ses
messages ont été supprimés à la main), `/timers create` le republie avec ses timers au lieu d'en créer un second.

## Ajouter un timer

Toute personne de niveau membre lance `/timers add` :

| Option | Signification |
| --- | --- |
| `type` | Ce que le timer suit (voir le tableau ci-dessous). |
| `place` | La ville. Commencez à taper son nom (ou celui de sa région) et choisissez une suggestion. |
| `owner` | Qui s'en occupe. Vous, si vous laissez vide. |

Un formulaire demande ensuite le **nom** (15 caractères au plus), le **code** quand le type en a un, et la **durée**
quand le timer décompte.

| Type | Compte | Code | Durée par défaut |
| --- | --- | --- | --- |
| Stockpile | à rebours | 6 chiffres, obligatoire | 50 h |
| Installation | à rebours | aucun | 50 h |
| Champ | en avant (temps depuis le dernier refresh) | aucun | non demandée |
| Navire | à rebours | 3 à 6 lettres ou chiffres, facultatif | 48 h |
| Char | à rebours | 3 à 6 lettres ou chiffres, facultatif | 48 h |
| Train | à rebours | 3 à 6 lettres ou chiffres, facultatif | 48 h |

Les durées de 50 h et 48 h sont celles du bot d'origine ; vous pouvez saisir n'importe quelle durée entre 1 minute et
30 jours. Écrivez des heures (`50`, `1.5`) ou des unités (`90m`, `2h30m`, `1d 12h`).

PICKET ne corrige jamais un lieu de lui-même : choisissez une suggestion, sinon la commande est refusée.

## Lire le tableau

Le tableau regroupe les timers par lieu. Chaque lieu a un en-tête (région, puis ville), suivi de trois colonnes :
**Asset** (lettre, type et nom), **Code** et **Timer** (le moment où le compte à rebours se termine, ou le temps écoulé
depuis le dernier refresh, puis le propriétaire) :

```text
[région] Allod's Bight
[ville] Mercy's Wail
Asset                Code      Timer
📦 🇦・Dépôt nord     123456    dans 2 jours・@Jules
```

- La lettre est celle du bouton sous le tableau. Les lettres repartent de A à chaque message : un tableau contient
  **25 timers actifs par message**, et PICKET ajoute un message quand il en faut un.
- Un timer dont le compte à rebours est terminé reste sur le tableau, avec son échéance affichée au passé, jusqu'à ce
  que quelqu'un le barre (ou que le tableau le purge).
- Sous le dernier message, le tableau indique l'heure de sa dernière mise à jour.
- Un timer barré est rayé, n'a plus de bouton et garde sa durée d'origine.

## Rafraîchir un timer

Cliquez sur son bouton lettre. Le compte à rebours repart de sa durée (ou de zéro pour un champ). Plusieurs clics en même
temps sont tous pris en compte, et le tableau est mis à jour une fois, pas une fois par clic.

## Barrer et nettoyer

- `/timers strike` propose les timers actifs du canal. Un timer barré reste visible, rayé.
- Ajouter à nouveau le même timer (même type, nom, lieu et code) ramène le timer barré au lieu de créer un doublon.
- `/timers cleanup` retire tout de suite les timers barrés. Sinon ils sont supprimés définitivement 24 heures plus tard
  (voir `purge-after`), comme les timers expirés.
- Un tableau sans aucun timer et sans modification depuis 30 jours est supprimé, avec son message et ses données.
  `/timers create` en recrée un. Le tableau n'est pas supprimé tant qu'il contient un timer.
- Après `/timers cleanup`, le tableau garde au moins un message.

## Alertes

Par défaut, PICKET publie une alerte **silencieuse** dans le canal 2 heures avant la fin d'un compte à rebours, avec un
bouton ✅ qui la retire. L'alerte disparaît d'elle-même quand le timer est rafraîchi, barré ou expiré, et revient pour
l'échéance suivante après un refresh.

Si PICKET a été interrompu, il envoie une seule alerte, celle du seuil le plus proche atteint, jamais une rafale
d'anciennes alertes.

Pour notifier un rôle, ajoutez-le avec `/timers settings alert-role`. Un rôle peut être notifié s'il est mentionnable,
ou si PICKET a la permission Discord **Mentionner @everyone, @here et tous les rôles**.

## Réglages

`/timers settings` sans option montre les réglages. Avec des options, il les modifie.

| Option | Signification | Défaut |
| --- | --- | --- |
| `alerts` | Envoyer les alertes. | activées |
| `thresholds` | Quand alerter avant la fin, par exemple `6h, 2h, 30m` (4 au plus, de 5 minutes à 7 jours). | `2h` |
| `alert-role`, `alert-role-action` | Rôles à notifier (5 au plus) : ajouter, retirer, ou tout vider. | aucun |
| `silent` | Alertes sans notification push. | oui |
| `duplicates` | Timer actif identique : l'ajouter en prévenant, ou le refuser. | prévenir |
| `restrict-changes` | Seuls le propriétaire d'un timer et les officiers peuvent le barrer ou le rafraîchir. | non |
| `max-active` | Timers actifs sur le tableau (1 à 100). | 50 |
| `purge-after` | Supprimer les timers barrés ou expirés après N heures (0 = jamais). | 24 |
| `reset-on-new-war` | Vider le tableau au début d'une nouvelle guerre. Prend effet à la sortie du war-log. | non |
| `region-emoji` | Icône devant la région dans le tableau : un emoji, un emoji personnalisé de votre serveur (`<:nom:id>`), ou `default`. | icônes de PICKET |
| `location-emoji` | Icône devant la ville dans le tableau, même format. | icônes de PICKET |

## Qui peut faire quoi

| Niveau | Peut |
| --- | --- |
| membre | Ajouter, barrer et rafraîchir des timers, acquitter des alertes. |
| officier | Créer un tableau, le nettoyer, le réparer, modifier ses réglages. |

Avec `restrict-changes`, un membre ne peut barrer ou rafraîchir que ses propres timers.

## Quand quelque chose se passe mal

- Un modérateur a supprimé un message du tableau : le prochain changement le republie, ou lancez `/timers repair`.
- PICKET n'a pas une permission ou Discord est lent : votre changement est enregistré, la réponse vous dit que le
  tableau sera mis à jour plus tard, et PICKET réessaie seul.
- Le canal a été supprimé : le tableau est désactivé et son historique conservé. Créez-en un nouveau avec
  `/timers create`.

## Ce que PICKET conserve

Contrairement aux todolists, les timers vivent dans la base de PICKET, car les comptes à rebours et les alertes doivent
survivre à un message supprimé ou à un redémarrage. PICKET conserve les réglages du tableau, chaque timer (type, nom,
code, lieu, propriétaire, début, durée) et un historique de qui a fait quoi. Les noms et les codes sont visibles de toute
personne qui peut lire le canal : n'y saisissez pas de donnée personnelle. Voir la
[Politique de confidentialité](../legal/privacy).
