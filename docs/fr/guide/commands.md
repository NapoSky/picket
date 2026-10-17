# Commandes

Les commandes commencent par `/picket`, `/todolist`, `/timers`, `/warlog`, `/stats` ou `/voice`, fonctionnent dans un serveur et répondent en privé. Les listes et tableaux créés sont des messages publics.

| Commande | Niveau | Effet |
| --- | --- | --- |
| `/picket settings` | officier | Ouvre le panneau privé de configuration, sans argument. Les permissions et données sont modifiables uniquement par les administrateurs. |
| `/stats export` | officier | Exporter exclusivement les statistiques de ce serveur (CSV/JSON, 1–60 jours). |
| `/stats settings` | officier | Activer explicitement la collecte et exclure des salons ; changer les rôles membres exige un administrateur. |
| `/stats status` | officier | Afficher les réglages et la rétention. |
| `/timers cleanup` | officier | Retire les timers barrés du tableau. |
| `/timers create` | officier | Crée le tableau de timers du canal. Voir [Timers](./timers). |
| `/timers repair` | officier | Republie les messages du tableau depuis les timers enregistrés. |
| `/timers settings` | officier | Ouvre le panneau privé du tableau de ce canal, sans argument : alertes, rôles, droits et nettoyage. |
| `/voice settings` | officier | Gérer les modèles vocaux, la limite par déploiement et les canaux ouverts. Comprend un bouton de retour aux réglages PICKET. |
| `/warlog settings` | officier | Choisit un salon textuel classique, une à trois zones et l’activation pour la guerre actuelle. Voir [Journal de guerre](./warlog). |
| `/picket status` | membre | Consulte la configuration, les modules disponibles, les rôles autorisés et ton niveau d’accès. |
| `/stats link` | membre | Ouvre [le dashboard officiel](https://stats.picket-foxhole.com). |
| `/stats privacy` | membre | Refuser le suivi ou effacer votre historique vocal. |
| `/timers add` | membre | Ajoute un timer au tableau : type et lieu (suggestions pendant la frappe), puis un formulaire. |
| `/timers strike` | membre | Barre un timer du tableau. |
| `/todolist create` | membre | Ouvre un formulaire et publie une todolist dans le canal. Voir [Todolists](./todolists). |
| `/voice create` | membre | Composer une file privée de modèles et quantités, puis déployer des vocaux éphémères. Voir [Vocaux éphémères](./voice). |

Voir [Statistiques vocales](./stats) pour les accès, la confidentialité et les métriques.

## Le panneau `/picket settings`

Le panneau est visible uniquement par la personne qui l’ouvre. Chaque modification est appliquée immédiatement et actualise le même message. Les contrôles expirent après quinze minutes d’inactivité ; relance la commande pour continuer.

Les rubriques ont chacune une couleur et une icône ; le bouton de la rubrique ouverte est surligné. L’état des modules affiche **🟢 Activé** ou **⚪ Désactivé**. Les confirmations mettent en évidence les données conservées ou supprimées.

- **Accueil** : langue et activation des modules Timers, Todolists, Journal de guerre et Stats. Activer le journal de guerre ouvre ses réglages de salon et de zones pour confirmation. **Configurer** rouvre les réglages du Journal de guerre ou de Stats déjà activé sans changer son activation. Ces panneaux proposent **Réglages PICKET** pour revenir à l’accueil ; ce bouton apparaît uniquement après une ouverture depuis `/picket settings`, et le retour conserve les modifications enregistrées. Désactiver un module demande confirmation : ses interactions et traitements s’arrêtent, mais les données restent conservées. Désactiver le journal de guerre annule aussi les messages en attente.
- **Langue** : une langue imposée s’applique à tout le monde. L’anglais, le français, l’allemand, l’espagnol, le portugais du Brésil, le polonais et le chinois simplifié sont disponibles. « Automatique » suit la langue Discord de chacun, puis celle du serveur Discord, puis l’anglais. Les langues sont paginées si nécessaire.
- **Permissions** : les officiers consultent les rôles ; les administrateurs ajoutent ou retirent un rôle à la fois. Donner l’accès membre à `@everyone` demande confirmation. `@everyone` ne peut jamais être officier. Ajoute un rôle membre avant de retirer `@everyone` si les membres doivent conserver l’accès.
- **Avancé** : le fuseau IANA reste une préconfiguration et ne modifie pas l’affichage des timers ; Discord affiche ses horodatages dans le fuseau de chacun. Le canal d’audit publie les changements de configuration, les créations de todolists, les créations et suppressions de timers et les acquittements d’alertes. Les relances de compte à rebours et le contenu des todolists sont exclus. PICKET doit pouvoir Voir le salon, Envoyer des messages et Intégrer des liens dans le salon choisi. Si cet accès disparaît, la publication se met en pause ; rétablis les permissions puis utilise **Tester / reprendre l’audit**. Configurez le journal de guerre avec `/warlog settings` ; voir [Journal de guerre](./warlog).
- **Données** : les administrateurs exportent les données du serveur ou demandent sa suppression. L’export inclut les réglages Stats, préférences de suivi et synthèses par membre sur 60 jours, avec les compteurs vocaux en attente ; les segments individuels et événements bruts sont exclus. Voir [Statistiques vocales](./stats#gérer-vos-données). L’écran explique la suppression, sa date et ses conséquences avant confirmation.

Chaque changement effectif de réglage ou permission est journalisé en base avec son auteur et les états avant/après. Répéter la même modification ne crée pas d’audit supplémentaire.

## Suppression et récupération

Dans **Données**, prévisualise puis confirme le retrait. PICKET envoie la confirmation privée finale avant de quitter le serveur et programme immédiatement la suppression des données. Si cette réponse ne peut pas être envoyée, le bot ne part pas ; réessaie la confirmation. Après le délai de conservation configuré par l’opérateur (30 jours par défaut), configuration, rôles d’accès, timers, historiques et audits sont supprimés définitivement. Les messages Discord, dont les todolists, ne sont pas supprimés automatiquement.

Pour annuler la suppression avant l’échéance, réinvite PICKET, puis ouvre `/picket settings` → **Données** en tant qu’administrateur du serveur et annule la suppression programmée. Réinviter le bot ne suffit pas à annuler une demande explicite de suppression. Voir [Confidentialité](../legal/privacy).

Les anciennes sous-commandes de configuration, permissions et données sont remplacées par ce panneau. Pendant la transition, une ancienne commande ouvre l’écran correspondant **sans appliquer ses arguments**.

Les vocaux éphémères sont activés par défaut. `/picket settings` gère leur activation ; `/voice settings` configure les modèles et propose **Réglages PICKET** pour revenir à l’accueil du serveur. Désactiver ce module bloque les nouveaux déploiements tout en maintenant le nettoyage des canaux existants. Voir [Vocaux éphémères](./voice).
