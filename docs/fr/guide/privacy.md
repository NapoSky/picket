# Confidentialité et données

::: warning
Cette page décrit ce que fait PICKET ; ce n'est pas un avis juridique. Si vous exploitez votre propre instance, vous en
êtes le responsable de traitement : adaptez cette page à votre situation et publiez vos coordonnées.
:::

## Ce que PICKET conserve

| Donnée | Pourquoi | Conservation |
| --- | --- | --- |
| Identifiant du serveur et réglages (langue, fuseau horaire, fonctionnalités activées) | Faire fonctionner le bot | Tant que le bot est sur le serveur, puis la période de rétention |
| Identifiants des rôles rattachés aux niveaux officier et membre | Contrôler l'accès | Idem |
| Journal d'audit : qui a changé quoi, quand, avant et après (identifiant d'utilisateur) | Traçabilité | Idem |
| Identifiant de chaque interaction traitée et son serveur | Ne pas traiter deux fois la même commande | 7 jours |
| Contenu des todolists | Aucun : il vit uniquement dans le message Discord | Non stocké par PICKET |
| Journaux de l'application : identifiants de serveur, d'utilisateur et de message pour chaque création et chaque clic de todolist, jamais le contenu de la liste | Exploiter et dépanner l'instance | Tant que l'opérateur conserve les journaux |

## Ce que PICKET ne conserve pas

- Le contenu des messages. PICKET ne demande pas l'intent de contenu des messages.
- Les messages privés. Les commandes ne fonctionnent que dans un serveur.
- Les pseudos, avatars ou toute donnée de profil des membres.

## Rétention et suppression

- **Le bot est retiré d'un serveur** : les données sont conservées pendant la période de rétention (30 jours par défaut),
  pour que le retour du bot restaure tout, puis elles sont effacées.
- **Un administrateur lance `/picket data delete`** : le serveur est suspendu et ses données sont effacées à la date
  annoncée, sauf si `/picket data cancel-deletion` est lancée avant.
- L'effacement supprime tout ce qui est lié au serveur, journal d'audit compris. Il est irréversible.

## Où vivent les données

Dans la base de données de l'opérateur de l'instance. Les serveurs sont isolés entre eux au niveau de la base : une
requête faite pour le compte d'un serveur ne peut pas lire les lignes d'un autre.
