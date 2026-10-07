# Commandes

Les commandes commencent par `/picket`, `/todolist` ou `/timers`, fonctionnent dans un serveur et répondent en privé. Les listes et tableaux créés sont des messages publics.

| Commande | Niveau | Effet |
| --- | --- | --- |
| `/picket status` | membre | Consulte la configuration, les modules disponibles, les rôles autorisés et ton niveau d’accès. |
| `/picket settings` | officier | Ouvre le panneau privé de configuration, sans argument. Les permissions et données sont modifiables uniquement par les administrateurs. |
| `/todolist create` | membre | Ouvre un formulaire et publie une todolist dans le canal. Voir [Todolists](./todolists). |
| `/timers create` | officier | Crée le tableau de timers du canal. Voir [Timers](./timers). |
| `/timers add` | membre | Ajoute un timer au tableau : type et lieu (suggestions pendant la frappe), puis un formulaire. |
| `/timers strike` | membre | Barre un timer du tableau. |
| `/timers cleanup` | officier | Retire les timers barrés du tableau. |
| `/timers repair` | officier | Republie les messages du tableau depuis les timers enregistrés. |
| `/timers settings` | officier | Ouvre le panneau privé du tableau de ce canal, sans argument : alertes, rôles, droits et nettoyage. |

## Le panneau `/picket settings`

Le panneau est visible uniquement par la personne qui l’ouvre. Chaque modification est appliquée immédiatement et actualise le même message. Les contrôles expirent après quinze minutes d’inactivité ; relance la commande pour continuer.

Les rubriques ont chacune une couleur et une icône ; le bouton de la rubrique ouverte est surligné. L’état des modules affiche **🟢 Activé** ou **⚪ Désactivé**. Les confirmations mettent en évidence les données conservées ou supprimées.

- **Accueil** : langue et activation des modules Timers et Todolists. Désactiver un module demande confirmation : ses interactions et traitements s’arrêtent, mais les données restent conservées.
- **Langue** : une langue imposée s’applique à tout le monde. L’anglais, le français, l’allemand, l’espagnol et le portugais du Brésil sont disponibles. « Automatique » suit la langue Discord de chacun, puis celle du serveur Discord, puis l’anglais. Les langues sont paginées si nécessaire.
- **Permissions** : les officiers consultent les rôles ; les administrateurs ajoutent ou retirent un rôle à la fois. Donner l’accès membre à `@everyone` demande confirmation. `@everyone` ne peut jamais être officier. Ajoute un rôle membre avant de retirer `@everyone` si les membres doivent conserver l’accès.
- **Avancé** : le fuseau IANA reste une préconfiguration et ne modifie pas l’affichage des timers ; Discord affiche ses horodatages dans le fuseau de chacun. Le canal d’audit publie les changements de configuration, les créations de todolists, les créations et suppressions de timers et les acquittements d’alertes. Les relances de compte à rebours et le contenu des todolists sont exclus. PICKET doit pouvoir Voir le salon, Envoyer des messages et Intégrer des liens dans le salon choisi. Si cet accès disparaît, la publication se met en pause ; rétablis les permissions puis utilise **Tester / reprendre l’audit**. Le war-log est indiqué « À venir », sans activation possible.
- **Données** : seuls les administrateurs voient cet écran. Il explique la suppression, sa date et ses conséquences avant confirmation.

Chaque changement effectif de réglage ou permission est journalisé en base avec son auteur et les états avant/après. Répéter la même modification ne crée pas d’audit supplémentaire.

## Suppression et récupération

Dans **Données**, prévisualise puis confirme la suppression. PICKET suspend immédiatement ses fonctionnalités. Après le délai de conservation configuré par l’opérateur (30 jours par défaut), configuration, rôles d’accès, timers, historiques et audits sont supprimés définitivement. Les messages Discord, dont les todolists, ne sont pas supprimés automatiquement.

Pendant la suspension, `/picket settings` reste accessible : il affiche la date et permet à un administrateur d’annuler. Les autres réglages sont indisponibles. Même après expiration du panneau, relancer cette commande permet de récupérer l’accès. Voir [Confidentialité](../legal/privacy).

Les anciennes sous-commandes de configuration, permissions et données sont remplacées par ce panneau. Pendant la transition, une ancienne commande ouvre l’écran correspondant **sans appliquer ses arguments**.
