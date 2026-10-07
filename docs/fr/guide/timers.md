# Timers

Un stockpile à renouveler, un navire à surveiller, un champ dont vous voulez connaître le dernier refresh : les timers
vous aident à suivre ces ressources ensemble. Chacun voit les échéances dans Discord, peut remettre un timer à zéro
après une intervention et recevoir une alerte avant son expiration.

Vous créez un **tableau dans un canal**, puis les membres y ajoutent leurs timers. PICKET organise l'affichage par lieu
et ajoute des messages au tableau quand il grandit. Vous n'avez pas à gérer les pages vous-même.

## Qui peut faire quoi ?

Les niveaux ci-dessous sont les accès **PICKET** configurés pour votre serveur, pas vos grades en jeu.

| Accès | Ce que vous pouvez faire |
| --- | --- |
| **Membre** | Ajouter un timer, le rafraîchir, le barrer et acquitter une alerte. |
| **Officier** | Tout ce qu'un membre peut faire, plus créer, régler, nettoyer et réparer les tableaux. Activer ou désactiver Timers dans `/picket settings`. |
| **Administrateur Discord** | Tout ce qu'un officier peut faire, plus gérer les rôles d'accès et exporter ou supprimer les données du serveur. |

Par défaut, tous les membres du serveur peuvent utiliser les timers, et les administrateurs peuvent créer les tableaux.
Un administrateur peut adapter ces accès dans `/picket settings` → **Permissions**. Consultez le
[guide des permissions](./permissions) pour les détails.

## Votre premier timer

Prenons un stockpile que votre groupe doit renouveler régulièrement.

1. **Un officier prépare le canal** : dans `#timers`, lancez `/timers create`. Le tableau apparaît dans ce canal.
2. **Un membre ajoute la ressource** : lancez `/timers add`, choisissez le type **Stockpile** et le lieu avec les
   suggestions proposées. L'option `owner` permet de désigner un responsable ; sinon, ce sera vous.
3. **Remplissez le formulaire** : par exemple, nom `Dépôt nord`, code `123456`, durée `50h`. Validez : le timer apparaît
   dans le tableau, avec son responsable et son échéance.
4. **Après avoir renouvelé le stockpile en jeu**, cliquez sur la lettre correspondant au timer. Son compte à rebours
   repart pour 50 heures.

Le bot doit pouvoir **Voir le salon**, **Envoyer des messages** (ou **Envoyer des messages dans les fils**) et
**Intégrer des liens**. PICKET vous indique une permission manquante lors de la création.

## Suivre les ressources au quotidien

### Lire le tableau

Les timers sont regroupés par région et par ville. Pour chaque ressource, le tableau affiche son nom, son code quand
elle en a un, son échéance ou le temps écoulé, puis son responsable. Par exemple :

```text
[région] Allod's Bight
[ville] Mercy's Wail
Asset                Code      Timer
📦 🇦・Dépôt nord     123456    dans 2 jours・@Jules
```

La lettre **🇦** permet de retrouver le bouton du timer. Les lettres recommencent à A sur chaque message : utilisez
le bouton sous le message qui contient votre ressource. Le premier message indique l'heure de mise à jour du tableau.
Un timer expiré reste visible avec une échéance passée ; un timer barré apparaît rayé et n'a plus de bouton.

### Mettre à jour ou retirer une ressource

| Vous voulez… | Faites ceci |
| --- | --- |
| Signaler un renouvellement en jeu | Cliquez sur le bouton lettre : le compte à rebours repart pour la durée prévue. Pour un champ, le temps écoulé repart de zéro. |
| Indiquer qu'une ressource n'est plus à suivre | Lancez `/timers strike` et choisissez le timer proposé. Il reste visible, barré. |
| Retirer les timers barrés du tableau | Un officier lance `/timers cleanup`. |
| Reprendre le suivi d'une ressource barrée | Ajoutez-la à nouveau avec le même type, nom, lieu et code : PICKET réactive son timer. |

Par défaut, les membres peuvent rafraîchir et barrer les timers des autres. Un officier peut réserver
ces deux actions au responsable du timer et aux officiers dans `/timers settings` → **Gestion du tableau**.

### Recevoir et acquitter les alertes

Par défaut, PICKET publie une **alerte silencieuse 2 heures avant l'échéance**, dans le canal du tableau. Cliquez sur
**✅** pour l'acquitter et retirer le message d'alerte. Cela ne rafraîchit pas le timer et ne le barre pas.

L'alerte disparaît aussi quand le timer est rafraîchi, barré ou expiré. Un refresh prépare les alertes de la prochaine
échéance. Après une interruption du bot, PICKET reprend avec le seuil d'alerte le plus proche atteint, sans envoyer
une rafale d'anciennes alertes.

Pour avertir un groupe, un officier peut configurer des rôles avec `/timers settings`. Le rôle doit être mentionnable,
ou le bot doit avoir la permission Discord **Mentionner @everyone, @here et tous les rôles**.

## Adapter les timers à votre organisation

### Choisir le type et la durée

| Ressource | Ce que le timer mesure | Code | Durée proposée |
| --- | --- | --- | --- |
| Stockpile | Temps restant avant l'échéance | 6 chiffres, obligatoire | 50 h |
| Installation | Temps restant avant l'échéance | Aucun | 50 h |
| Champ | Temps écoulé depuis le dernier refresh | Aucun | Pas de compte à rebours |
| Navire, char ou train | Temps restant avant l'échéance | 3 à 6 lettres ou chiffres, facultatif | 48 h |

Les durées proposées sont des valeurs par défaut : adaptez-les à votre besoin. Vous pouvez écrire des heures
(`50`, `1.5`) ou combiner des unités (`90m`, `2h30m`, `1d 12h`). Pour le lieu, commencez à saisir une ville ou une région,
puis **choisissez une suggestion** : PICKET ne devine pas un lieu saisi librement.

### Régler un tableau

Un officier lance `/timers settings` **dans le canal du tableau**, sans aucun argument. PICKET ouvre un panneau
privé : choisissez une rubrique, cliquez sur un bouton ou remplissez un formulaire. Chaque changement est appliqué
immédiatement et le même panneau est actualisé. Les réglages concernent ce tableau, pas tous ceux du serveur.

| Écran | Ce que vous pouvez régler |
| --- | --- |
| **Accueil** | Consulter le nombre de timers actifs, les principaux réglages et l'état de l'affichage. |
| **🔔 Alertes** | Activer ou désactiver les alertes, choisir les délais avant l'échéance, le mode silencieux et les rôles à notifier. |
| **🛡️ Gestion du tableau** | Choisir qui peut barrer et rafraîchir, gérer les doublons et régler le nettoyage automatique. |

Pour notifier un rôle, choisissez-le dans le sélecteur de l'écran **Alertes**. Vous pouvez ajouter ou retirer les rôles
un par un, ou tous les retirer. L'ajout de `@everyone` demande confirmation. Le bouton **Modifier** ouvre un formulaire
prérempli pour les délais d'alerte ou le délai de nettoyage : vous n'avez aucun nom de paramètre à connaître.

La désactivation des alertes demande confirmation. Pour le nettoyage automatique, un nouveau délai non nul demande
aussi confirmation : les timers barrés ou expirés qui dépassent déjà ce délai peuvent être supprimés immédiatement.

::: details Réglages disponibles et valeurs par défaut

| Réglage | Choix | Défaut |
| --- | --- | --- |
| Alertes | Activées ou désactivées. | Activées |
| Délais avant l'échéance | Par exemple `6h, 2h, 30m` : jusqu'à 4 délais, de 5 minutes à 7 jours. | `2h` |
| Rôles à notifier | Jusqu'à 5 rôles. | Aucun |
| Notifications | Mode silencieux ou notifications push. | Silencieux |
| Timers identiques | Autoriser avec un avertissement, ou refuser l'ajout. | Autoriser et prévenir |
| Qui peut barrer et rafraîchir | Tous les membres, ou le responsable et les officiers uniquement. | Tous les membres |
| Nettoyage automatique | Après 1 à 720 heures ; `0` le désactive. | 24 h |

:::

Les icônes de région et de ville sont celles de PICKET, et la limite est fixe à **50 timers actifs par tableau**.
Le reset lors d'une nouvelle guerre est présenté **À venir**, sans bouton d'activation : il dépend du war-log,
qui n'est pas encore disponible.

Le panneau est réservé à la personne qui l'ouvre et expire après 15 minutes sans actualisation. Relancez simplement
`/timers settings` pour en ouvrir un nouveau. Les droits sont revérifiés à chaque interaction. Lors de la transition,
une ancienne commande avec des arguments ouvre ce panneau **sans appliquer ses arguments**.

Pour activer ou désactiver **tout le module Timers**, utilisez `/picket settings`. Sa désactivation suspend les
interactions et les traitements des timers, en conservant les données.

## Limites

Un **tableau** est l'ensemble des timers d'un canal ; un **message** est une page de ce tableau.

| Limite | Valeur |
| --- | --- |
| Tableaux par serveur | 10 |
| Tableaux par canal | 1 |
| Timers actifs par tableau, toutes pages confondues | 50, limite fixe |
| Timers actifs par message | 25 au maximum ; moins si la taille du contenu l'impose |
| Messages par tableau | Ajoutés et retirés automatiquement selon le contenu, avec au moins un message conservé |
| Nom d'un timer | 15 caractères |
| Durée d'un compte à rebours | De 1 minute à 30 jours |

**26 timers actifs occupent au moins deux messages, mais toujours un seul tableau dans un seul canal.** La limite de
10 tableaux par serveur permet donc jusqu'à 10 canaux de timers, avec plusieurs messages dans chacun.

Un timer **barré** libère une place dans le quota actif. Un timer **expiré** continue de compter jusqu'à ce qu'il soit
barré ou purgé. Si un ancien tableau contient déjà plus de 50 timers actifs, ils sont conservés, mais aucun ajout
n'est possible tant que leur nombre n'est pas redescendu sous 50.

Par défaut, les timers barrés sont supprimés 24 heures après avoir été barrés ; les timers expirés, 24 heures après
leur échéance. Un tableau vide et sans modification depuis 30 jours est également supprimé. Un tableau qui contient
encore un timer est conservé.

## Si quelque chose ne fonctionne pas

| Situation | Que faire ? |
| --- | --- |
| Une commande ou un bouton vous est refusé | Vérifiez vos rôles PICKET, l'activation de Timers et les permissions Discord. Si les changements sont réservés aux responsables, vérifiez aussi le responsable du timer. Les droits sont revérifiés à chaque action. |
| Vous ne pouvez plus ajouter de timer | La limite est de 50 timers actifs. Barrez les ressources terminées pour libérer une place. Les timers expirés comptent encore tant qu'ils ne sont pas barrés ou purgés. |
| Le lieu est refusé | Relancez l'ajout en choisissant une suggestion de ville ou de région. |
| Un message du tableau a été supprimé | Le prochain changement le republie ; un officier peut aussi lancer `/timers repair`. |
| PICKET annonce que l'affichage sera mis à jour plus tard | Le changement est enregistré. Vérifiez les permissions du bot si nécessaire ; PICKET réessaie automatiquement. |
| Le canal a été supprimé | Son tableau est désactivé et ses données conservées. Un officier peut créer un tableau dans un autre canal. |
| Un ancien tableau vide a disparu | Après 30 jours sans activité, il est supprimé. Lancez `/timers create` pour en créer un nouveau. |

## Ce que PICKET stocke

Les timers sont enregistrés dans la base de PICKET pour continuer à fonctionner après un redémarrage et permettre de
recréer l'affichage. Cela comprend les identifiants du serveur, du canal et des messages, les réglages du tableau,
les ressources suivies (**type, nom, code, lieu, responsable, début, durée et état**) et les informations nécessaires
aux alertes.

PICKET conserve aussi un historique des actions et des journaux de fonctionnement liés au serveur, avec leurs dates,
les identifiants des personnes concernées et les détails de l'action. Les noms et les codes des timers peuvent figurer
dans cet historique. **Les journaux en base ont une rétention de 30 jours** ; les données des timers ne sont pas
soumises à ce délai de journalisation et suivent leur propre cycle de suppression décrit ci-dessus. Les données d'un
tableau désactivé après la suppression de son canal restent conservées jusqu'à la suppression des données du serveur.

Les noms et les codes sont visibles par les personnes qui peuvent lire le canal du tableau. Si un canal d'audit est
configuré, la création, la réactivation, les timers barrés ou supprimés et l'acquittement d'alertes peuvent aussi y être
signalés avec les détails disponibles de l'action. Les rafraîchissements ne sont pas publiés dans ce canal. La rétention
de 30 jours des journaux
**ne supprime pas les messages d'audit déjà publiés dans Discord**.

Un administrateur peut exporter les données stockées ou demander leur suppression dans `/picket settings` →
**Données**. La suppression des données du bot ne supprime pas automatiquement les messages Discord. Consultez la
[Politique de confidentialité](../legal/privacy) pour le cadre général de conservation.
