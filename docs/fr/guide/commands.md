# Commandes

Les commandes commencent par `/picket`, `/todolist` ou `/timers`, ne fonctionnent que dans un serveur et répondent en privé (vous seul voyez
la réponse).

| Commande | Niveau | Effet |
| --- | --- | --- |
| `/picket status` | membre | Montre que PICKET fonctionne, la langue et le fuseau horaire du serveur, et les fonctionnalités activées. |
| `/picket permissions show` | membre | Montre qui a les niveaux officier et membre, votre propre niveau, et des avertissements sur la configuration. |
| `/picket permissions set` | administrateur | Ajoute ou retire un rôle d'un niveau. |
| `/todolist create` | membre | Ouvre un formulaire et publie une todolist dans le canal. Voir [Todolists](./todolists). |
| `/timers board create` | officier | Crée le tableau de timers du canal. Voir [Timers](./timers). |
| `/timers add` | membre | Ajoute un timer au tableau : type, région et lieu (suggestions pendant la frappe), puis un formulaire. |
| `/timers strike` | membre | Barre un timer du tableau. |
| `/timers cleanup` | officier | Retire les timers barrés du tableau. |
| `/timers repair` | officier | Republie les messages du tableau depuis les timers enregistrés. |
| `/timers settings` | officier | Montre ou modifie les réglages du tableau : alertes, limites, purge. |
| `/picket settings language` | officier | Définit la langue du serveur, ou revient à l'automatique. |
| `/picket settings timezone` | officier | Définit le fuseau horaire du serveur. |
| `/picket settings audit-channel` | officier | Définit (ou retire) le canal d'audit. |
| `/picket settings feature` | officier | Active ou désactive une fonctionnalité. |
| `/picket data delete` | administrateur | Programme la suppression définitive des données du serveur. |
| `/picket data cancel-deletion` | administrateur | Annule une suppression programmée. |

## `/picket permissions set`

| Option | Signification |
| --- | --- |
| `level` | `Officier` ou `Membre`. |
| `role` | Le rôle à modifier. `@everyone` n'est accepté que pour `Membre`. |
| `action` | `Ajouter` ou `Retirer`. |
| `confirm` | Obligatoire pour donner le niveau membre à `@everyone`, car cela ouvre PICKET à tout le serveur. |

Répéter un changement ne fait rien et n'est pas journalisé. Chaque changement effectif est enregistré dans le journal
d'audit avec l'auteur, l'heure et l'état avant et après.

## `/picket settings`

- **`language`** : choisissez une langue, ou `Automatique`. Avec une langue choisie, **tout le monde** reçoit les réponses
  de PICKET dans cette langue, quelle que soit sa langue Discord. `Automatique` suit la langue Discord de chacun, puis
  l'anglais.
- **`timezone`** : un nom IANA comme `Europe/Paris`, `America/New_York` ou `UTC`. Il ne change que l'affichage et les
  regroupements des heures ; les heures sont stockées en UTC.
- **`audit-channel`** : le canal destiné à recevoir le journal d'audit. Laissez l'option vide pour le retirer. PICKET n'y
  publie pas encore : en attendant, les changements sont enregistrés dans le journal d'audit en base.
- **`feature`** : `Timers`, `Todolists` ou `War log`, et `enabled` vrai ou faux. Les timers et les todolists sont
  disponibles ; l'interrupteur `War log` est mémorisé dès maintenant pour que votre choix soit déjà en place à sa sortie.

Chaque changement effectif est enregistré dans le journal d'audit, comme les changements de permissions.
`/picket status` montre les valeurs actuelles.

## `/picket data delete`

Lancez-la sans `confirm` pour voir exactement ce qui va se passer et quand. Avec `confirm:True`, le serveur est
**suspendu** : PICKET refuse toutes les commandes sauf `/picket data cancel-deletion` jusqu'à la date de suppression,
puis efface les données. Voir [Politique de confidentialité](../legal/privacy).

## À venir

Le war-log Foxhole. Il apparaîtra ici à sa sortie.
