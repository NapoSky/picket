# Prise en main

## Ajouter PICKET à votre serveur

Invitez le bot avec les scopes `bot` et `applications.commands`. Les commandes répondent directement à la personne qui les
a utilisées : elles n'ont besoin d'aucune permission de canal. **Les todolists et les tableaux de timers publient des
messages publics** : dans les canaux où vous les utilisez, le bot a besoin de **Voir le salon**, **Envoyer des messages**
(ou **Envoyer des messages dans les fils**) et **Intégrer des liens**. PICKET vous dit laquelle manque avant d'ouvrir le
formulaire. Les autres fonctionnalités qui publient des messages (war-log) indiqueront ce qu'elles demandent avant que
vous les activiez.

PICKET ne demande que l'intent Gateway `Guilds`, non privilégié. Il ne lit jamais le contenu des messages et n'a pas
besoin de l'intent des membres.

## Premiers pas

1. Lancez `/picket status` pour vérifier que le bot répond et consulter les permissions. Au départ, tout le monde a le niveau membre ; seuls les administrateurs peuvent configurer PICKET.
2. En tant qu’administrateur, ouvrez `/picket settings`, puis **Permissions → Qui peut configurer PICKET ?**, et sélectionnez votre rôle officier.
3. Pour réserver le bot au régiment, ajoutez votre rôle dans **Qui peut utiliser PICKET ?**, puis retirez l’accès à `@everyone`.
4. Choisissez la langue et les modules depuis l’accueil du panneau. Le fuseau horaire est une préconfiguration avancée et n’est pas nécessaire pour utiliser le bot.

::: tip Qui peut modifier les permissions ?
Uniquement les administrateurs du serveur : le propriétaire, et toute personne ayant un rôle avec la permission Discord
**Administrateur**.
:::

## Langues

PICKET répond dans la langue choisie pour le serveur avec `/picket settings`. Par défaut (`Automatique`), il
répond dans la langue de la personne qui lance la commande (anglais et français fournis), puis dans celle de la
communauté Discord, puis en anglais. Les noms de commandes sont toujours en anglais ; leurs descriptions suivent la
langue de votre Discord. Voir [Traduire](../contributing/translating) pour ajouter la vôtre.
