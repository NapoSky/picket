# Prise en main

## Ajouter PICKET à votre serveur

Invitez le bot avec les scopes `bot` et `applications.commands`. Les commandes répondent directement à la personne qui les
a utilisées : elles n'ont besoin d'aucune permission de canal. **Les todolists publient des messages publics** : dans les
canaux où vous les utilisez, le bot a besoin de **Voir le salon**, **Envoyer des messages** (ou **Envoyer des messages dans
les fils**) et **Intégrer des liens**. PICKET vous dit laquelle manque avant d'ouvrir le formulaire. Les autres
fonctionnalités qui publient des messages (timers, war-log) indiqueront ce qu'elles demandent avant que vous les activiez.

PICKET ne demande que l'intent Gateway `Guilds`, non privilégié. Il ne lit jamais le contenu des messages et n'a pas
besoin de l'intent des membres.

## Premiers pas

1. Lancez `/picket status` pour vérifier que le bot répond et voir comment le serveur est configuré.
2. Lancez `/picket permissions show` pour voir qui peut utiliser PICKET. Un nouveau serveur démarre avec **tout le monde**
   autorisé à utiliser les commandes de membre et **personne** au niveau officier.
3. Choisissez vos officiers : `/picket permissions set level:Officier role:@VosOfficiers action:Ajouter`.
4. Si vous le souhaitez, réservez les commandes de membre à votre régiment : ajoutez votre rôle membre, puis retirez
   `@everyone` (voir [Permissions](./permissions)).
5. Définissez le fuseau horaire de votre serveur : `/picket settings timezone timezone:Europe/Paris`.

::: tip Qui peut modifier les permissions ?
Uniquement les administrateurs du serveur : le propriétaire, et toute personne ayant un rôle avec la permission Discord
**Administrateur**.
:::

## Langues

PICKET répond dans la langue choisie pour le serveur avec `/picket settings language`. Par défaut (`Automatique`), il
répond dans la langue de la personne qui lance la commande (anglais et français fournis), puis dans celle de la
communauté Discord, puis en anglais. Les noms de commandes sont toujours en anglais ; leurs descriptions suivent la
langue de votre Discord. Voir [Traduire](../contributing/translating) pour ajouter la vôtre.
