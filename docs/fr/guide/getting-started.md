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

PICKET propose **l’anglais, le français, l’allemand, l’espagnol et le portugais du Brésil**. Choisissez une langue fixe
pour tout le monde dans `/picket settings` → **Langue**, ou conservez **Automatique** : PICKET suit la langue Discord
de la personne, puis celle du serveur Discord, puis l’anglais. Les variantes espagnoles utilisent le catalogue
espagnol ; les variantes portugaises utilisent le catalogue du portugais du Brésil lorsqu’aucune traduction exacte
n’est disponible.

Les noms de commandes restent en anglais ; leurs descriptions suivent la langue de votre Discord.
Voir [Traduire](../contributing/translating) pour ajouter une langue ou améliorer une traduction existante.
