# Statistiques vocales

Repérer les horaires où le groupe se rassemble, consulter votre présence ou préparer le prochain briefing : les
statistiques donnent une vue de l'activité vocale de votre régiment, par personne et par serveur.

Le dashboard de l'instance officielle se trouve sur **[stats.picket-foxhole.com](https://stats.picket-foxhole.com)**.
Vous pouvez aussi l'ouvrir avec `/stats link`, puis vous connecter avec Discord.

La collecte est **désactivée par défaut**. Un administrateur choisit les rôles membres à suivre, puis un officier peut
l'activer. L'historique démarre à ce moment-là et couvre au maximum **60 jours glissants**.

La **vue vocale admin de l’instance** utilise un instantané planifié, actualisé par défaut à minuit et midi dans le fuseau de l’instance. « Données arrêtées au » indique sa date ; les personnes en vocal correspondent à cet instantané. Les filtres de période et salon consultent le même instantané. Les vues membre et officier restent actuelles. Un effacement ou une purge invalide immédiatement l’instantané : la vue admin devient temporairement indisponible pendant sa reconstruction par le worker. L’affichage reste limité à 60 jours glissants.

## Qui peut faire quoi ?

La configuration et les exports Discord utilisent les accès **PICKET** définis pour votre serveur, pas vos grades
en jeu. Dans le dashboard, tout membre actuel du serveur peut consulter la vue d'ensemble et ses propres données,
même s'il ne fait pas partie des rôles suivis.

| Accès | Ce que vous pouvez faire |
| --- | --- |
| **Membre du serveur** | Consulter les totaux du serveur et votre propre activité ; gérer votre suivi et effacer vos statistiques dans le dashboard. `/stats link` et `/stats privacy` demandent le niveau membre PICKET. |
| **Officier** | Tout ce qu'un membre peut faire, plus consulter et exporter les données individuelles de ce serveur ; activer, désactiver la collecte et choisir les salons exclus. |
| **Administrateur Discord** | Tout ce qu'un officier peut faire, plus choisir les rôles membres ciblés et gérer les permissions générales. |
| **Administrateur d'instance** | Consulter les statistiques de tous les serveurs de cette instance, y compris l'historique encore conservé des serveurs inactifs. |

Les **rôles membres ciblés sont partagés avec les permissions générales** : les remplacer dans les réglages Stats
modifie aussi l'accès aux commandes membres. Un administrateur configure les rôles officiers dans
`/picket settings` → **Permissions**. Consultez le [guide des permissions](./permissions) pour les détails.

L'accès d'instance revient aux membres ayant **accepté l'invitation de la Team propriétaire de l'application du bot**,
y compris les rôles developer et read-only. Une invitation en attente ne suffit pas. Un rôle officier sur un serveur
ne donne aucun accès aux données individuelles des autres serveurs.

![Page de connexion PICKET en anglais : bannière complète, carte de connexion épurée et bouton SSO Discord.](/images/stats-login-en.png)

*Connectez-vous avec votre compte Discord. Vos permissions déterminent les tableaux de bord accessibles.*

## Vos premières statistiques

Accordez à PICKET **Voir les salons** sur les salons vocaux à suivre, y compris les salons privés et les
dérogations de leurs catégories. Le bot peut ainsi recevoir les métadonnées et les noms des salons. Les statistiques
ne demandent pas **Se connecter**, **Parler** ou **Administrateur**. Les vérifications d'accès du dashboard utilisent
le scope `guilds.members.read` de votre compte OAuth, indépendamment des permissions du bot sur les salons.

Supposons que votre groupe utilise les rôles **Membre** et **Logistique**, et souhaite exclure le salon **Pause**.

1. **Un administrateur ouvre `/stats settings`**, depuis n'importe quel salon du serveur. Ce panneau est aussi
   accessible dans `/picket settings` → **Statistiques**.
2. **Choisissez les rôles membres** : sélectionnez **Membre** et **Logistique**. Une personne possédant au moins un
   des deux rôles sera suivie. Cette sélection remplace les rôles membres généraux de PICKET.
3. **Choisissez les salons exclus**, par exemple **Pause**. Les bots et le salon AFK natif sont déjà exclus.
4. Cliquez sur **Activer**. Les connexions, déconnexions et changements de salon éligibles commencent à alimenter
   les statistiques ; aucun historique antérieur n'est importé.
5. Ouvrez **[le dashboard](https://stats.picket-foxhole.com)** ou lancez `/stats link`, cliquez sur **Continuer avec
   Discord**, puis choisissez votre serveur et une période.

::: warning Choisir de vrais rôles membres
Une sélection vide ou contenant **`@everyone`, même avec d'autres rôles**, empêche l'activation. Un administrateur
doit remplacer cette sélection avant de pouvoir activer les statistiques. Informez les membres du suivi avant activation.
:::

Pour une instance auto-hébergée, `/stats link` pointe vers le dashboard configuré par son opérateur. L'adresse officielle
ci-dessus ne donne pas accès aux données des autres instances. Les réglages techniques sont dans le
[guide d'auto-hébergement](../self-hosting/configuration#statistiques-vocales-et-dashboard).

## Suivre l'activité dans le dashboard

### Voir le déploiement de PICKET

Ouvrez **Vue d’ensemble** → **PICKET** pour consulter le nombre de Discords actuellement actifs sur
cette instance et ceux où **Timers**, **TodoLists**, **Warlog** ou les **Statistiques vocales** sont activés. Les cartes
et les barres d'adoption montrent les effectifs et leur proportion parmi les serveurs actifs. Cette vue est accessible
à toute personne connectée et s'actualise chaque minute ; **Actualiser** permet de la rafraîchir immédiatement.

![Vue d’ensemble, onglet PICKET, en anglais : nombre total de Discords actifs, effectifs par fonctionnalité et pourcentages d'adoption.](/images/stats-picket-en.png)

*Aperçu en anglais avec des données fictives. Seuls les chiffres agrégés du déploiement sont partagés.*

Ces chiffres décrivent la configuration actuelle, pas l'utilisation réelle des fonctionnalités sur une période. Les
serveurs quittés par PICKET ou suspendus sont exclus. Désactiver le suivi vocal ne retire pas un serveur du déploiement
actif de PICKET. Plusieurs fonctionnalités peuvent être activées sur un même serveur : leurs effectifs se recoupent.
Cette vue est indépendante des filtres vocaux période et salon et ne donne aucun accès aux noms, réglages ou historiques
individuels des autres serveurs.

### Lire la vue d'ensemble

Choisissez **Vue d'ensemble** pour voir les totaux du serveur sans afficher les historiques individuels. Les cartes
résument le temps cumulé, les personnes actives, les segments de présence et les personnes actuellement en vocal.
Les graphiques montrent l'évolution quotidienne et les salons où le groupe se rassemble.

![Vue d'ensemble du dashboard PICKET en anglais et en mode sombre : filtres serveur, période et salon, indicateurs de présence, graphique quotidien et temps vocal par salon.](/images/stats-overview-en.png)

*Illustration avec l'interface en anglais, un régiment et des données fictifs. La vue d'ensemble montre les totaux du serveur ; aucun historique
individuel n'y apparaît.*

| Indicateur | Comment le lire |
| --- | --- |
| **Heures vocales** | Temps cumulé de toutes les personnes éligibles sur la période. Deux personnes présentes une heure donnent deux heures vocales. |
| **Personnes actives** | Personnes distinctes ayant une présence enregistrée sur la période. |
| **Segments de présence** | Présences continues dans un même salon. Passer d'un salon à un autre ouvre un nouveau segment. |
| **Actuellement en vocal** | Dernières présences connectées confirmées par la collecte. |
| **Pic de présences simultanées** | Maximum de présences en même temps sur la période, pour le périmètre sélectionné. |

Les totaux quotidiens et horaires utilisent le fuseau du serveur configuré dans `/picket settings`, changements d'heure
compris. La vue globale d'instance utilise UTC. **Temps vocal signifie présence, pas temps de parole ni preuve d'activité
en jeu.** Mute, sourdine, vidéo et partage d'écran ne créent pas de segment supplémentaire.

Le dashboard s'actualise chaque minute, avec une fraîcheur normale visée sous deux minutes. L'heure de dernière
confirmation reste visible. Une interruption est signalée et le temps non observé n'est pas ajouté automatiquement.

### Consulter votre activité ou celle du régiment

Ouvrez **Activité vocale**. Un membre voit uniquement ses propres données dans le serveur sélectionné. S'il appartient
à plusieurs serveurs utilisant cette instance, il peut passer de l'un à l'autre avec le filtre **Serveur**.

Un officier ou administrateur Discord peut choisir **Mon activité** ou **Activité du régiment**. Le tableau indique
le temps vocal et la dernière présence de chaque personne autorisée ; les présences récentes détaillent les heures de
connexion, de déconnexion ou de dernière confirmation.

![Activité personnelle dans le dashboard PICKET en anglais et en mode clair : temps vocal de Rook, dernière présence et détail d'un segment dans le salon Operations.](/images/stats-personal-en.png)

*Illustration de la vue personnelle en anglais et en mode clair, avec des données fictives. Le filtre Serveur détermine l'historique consulté ;
les droits sont revérifiés côté service.*

Les tableaux sont paginés lorsqu'ils dépassent 1 000 personnes. Les présences récentes affichent les 100 derniers
segments de la période. **Aucune activité observée** ne signifie pas **jamais actif** : la personne peut ne pas avoir
été ciblée, avoir refusé le suivi ou avoir fréquenté un salon exclu.

### Comparer les serveurs de l'instance

Les administrateurs d'instance ouvrent **Administration**, puis choisissent **Tous les serveurs**.
Le graphique quotidien des heures vocales empile une série colorée par Discord : la hauteur totale donne les heures
vocales de l'instance ce jour-là. **Les personnes actives au fil des jours** affiche une courbe par serveur et un total
d'instance en pointillés, qui compte chaque personne une seule fois même si elle a fréquenté plusieurs serveurs ce jour-là.
Survolez un graphique, ou sélectionnez-le au clavier et utilisez les flèches, pour lire les chiffres quotidiens.

![Dashboard d'instance PICKET en anglais : heures vocales quotidiennes empilées par serveur, courbes de personnes actives et récapitulatif par serveur.](/images/stats-instance-en.png)

*Aperçu en anglais avec des données fictives. Les couleurs distinguent les serveurs ; la courbe en pointillés déduplique les personnes à l'échelle de l'instance.*

**Activité par serveur** récapitule aussi les heures vocales et les personnes actives distinctes sur toute la période
sélectionnée. Un officier dispose de ces métriques pour le régiment sélectionné dans **Activité du régiment**, selon
ses droits existants. Ces effectifs désignent les personnes ayant une activité vocale enregistrée, pas l'ensemble des
membres des rôles ciblés. Additionner les effectifs quotidiens ne donne pas l'effectif distinct de la période ; additionner
les effectifs des serveurs ne donne pas le nombre de personnes uniques de l'instance. Les filtres période et salon,
la fenêtre de 60 jours et l'effacement s'appliquent à toutes ces vues.

Les administrateurs d’instance peuvent aussi sélectionner les serveurs inactifs dont les données sont encore
conservées. Ils apparaissent après les serveurs actifs, en gris avec la mention **Inactif**, et restent sélectionnables
jusqu’à l’effacement. PICKET conserve leur dernier nom Discord connu ; les noms manquants d’anciens enregistrements
sont récupérés lorsque Discord les fournit encore. Si le nom n’a jamais été enregistré et n’est plus accessible,
le sélecteur affiche explicitement **Serveur inconnu** avec son ID. Désactiver la collecte vocale seule ne rend pas
le serveur inactif.

![Vue d’ensemble PICKET en anglais : Reserve Company conserve son nom, avec le badge Inactive, une sélection grisée et un message sur l’historique conservé.](/images/stats-inactive-en.png)

*Données fictives illustrant un serveur inactif conservé ; cet accès nécessite les droits d’administrateur d’instance.*

## Adapter le suivi à votre groupe

### Choisir les personnes et les salons

Un officier ouvre `/stats settings` pour activer ou désactiver la collecte et changer les salons exclus. Seul un
administrateur Discord peut remplacer les rôles membres ciblés. Le panneau est privé, appartient à la personne qui
l'ouvre et ses contrôles expirent après quinze minutes ; relancez la commande si nécessaire.

::: details Réglages disponibles et valeurs par défaut

| Réglage | Choix | Par défaut |
| --- | --- | --- |
| Collecte | Activation explicite par serveur. | Désactivée |
| Personnes suivies | Au moins un des rôles membres sélectionnés ; `@everyone` interdit. | Rôles membres des permissions générales |
| Bots | Toujours exclus. | Exclus |
| Salon AFK natif | Toujours exclu. | Exclu |
| Autres salons exclus | Sélection de salons vocaux ou scène ; **Retirer les exclusions** retire la sélection. | Aucun |
| Période du dashboard | 24 heures, 7, 14, 30 ou 60 jours. | 7 jours |
| Interface du dashboard | Français ou anglais ; thème clair, sombre ou système. | Langue du navigateur et thème système |

:::

Gagner un rôle cible pendant une présence démarre le suivi ; perdre le dernier rôle cible l'arrête. Changer la
sélection affecte la collecte future. L'historique auparavant enregistré reste disponible jusqu'à expiration ou effacement.
Si la sélection devient vide ou inclut `@everyone`, la collecte s'arrête automatiquement.

### Exporter les statistiques

Dans **Activité vocale**, choisissez le serveur, la période, le salon et la vue, puis cliquez sur **Exporter en CSV**
ou **JSON**. Un membre exporte ses propres données ; un officier exporte celles du régiment uniquement sur les serveurs
où il possède cet accès.

Dans Discord, un officier peut utiliser **`/stats export days:7 format:csv`** pour obtenir les statistiques de ce
serveur en réponse privée. `days` accepte de 1 à 60 ; `format` accepte CSV ou JSON. `/stats status` affiche les réglages
et la durée de conservation.

Un export trop grand est refusé avec un message : réduisez la période ou choisissez un salon dans le dashboard.
Les contrôles d'accès sont revérifiés avant export. La conservation des fichiers téléchargés relève de leur destinataire.

Les exports Discord et dashboard utilisent le même format : un tableau JSON de personnes, ou une ligne CSV par personne. Les durées sont en secondes et les dates en UTC. Les exports globaux administrateur ajoutent `guildId` / `guild_id` pour distinguer chaque serveur.

```json
[
  {
    "userId": "407197937387700225",
    "username": "elchap1567",
    "totalSeconds": 49353,
    "lastActivityDate": "2026-10-13T04:33:10+00:00"
  }
]
```

```csv
user_id,username,total_seconds,last_activity_date
407197937387700225,elchap1567,49353,2026-10-13T04:33:10+00:00
```

### Gérer vos données

Un administrateur Discord peut télécharger l'export des données du serveur dans `/picket settings` → **Données**.
Il inclut les réglages Stats, les préférences de suivi, une vue `stats_summary` et un tableau `stats_members` avec une
ligne par membre : `userId`, `username`, `totalSeconds` et `lastActivityDate`. Les totaux vocaux couvrent au maximum
60 jours, même avant le nettoyage physique. `pendingEvents` et `lastPendingActivityDate` décrivent les données vocales
encore en attente ; aucune durée non confirmée n'est ajoutée aux totaux. Les événements bruts, segments individuels et
entrées du journal disque ne sont pas listés. Un export trop volumineux est refusé intégralement.
À la suppression programmée du serveur, les faits disque et marqueurs de suivi sont également effacés ; un échec
conserve le serveur dans le registre pour permettre une nouvelle tentative. Cet export inclut aussi les autres
fonctionnalités du bot ; les téléchargements CSV/JSON décrits plus haut contiennent uniquement les synthèses vocales.

Ouvrez **Vos données, votre choix** dans le dashboard, ou utilisez `/stats privacy` dans Discord.

| Vous voulez… | Faites ceci |
| --- | --- |
| Arrêter les prochaines collectes | Cochez **M'exclure des prochaines collectes**, puis **Enregistrer ma préférence**. L'historique déjà enregistré reste jusqu'à expiration ou effacement. |
| Reprendre le suivi | Décochez cette option et enregistrez ; les rôles et salons ciblés continuent de s'appliquer. |
| Effacer votre historique du serveur sélectionné | Cliquez sur **Effacer mes statistiques**, puis confirmez. Dans le dashboard, saisissez `DELETE`. |
| Effacer vos données de toute cette instance, y compris après votre départ d'un serveur | Cliquez sur **Effacer toutes mes données** en haut du dashboard et confirmez. Votre suivi est également désactivé sur les serveurs concernés. |

![Contrôles de confidentialité PICKET en anglais : exclusion des prochaines collectes, enregistrement de préférence et bouton d'effacement des statistiques.](/images/stats-privacy-en.png)

*Illustration des contrôles en anglais, avec le suivi volontairement désactivé pour le compte fictif. L'effacement est confirmé séparément,
retire aussi votre contribution des totaux et supprime les événements encore en attente.*

## Limites

| Limite | Valeur |
| --- | --- |
| Historique consultable | 60 jours glissants maximum |
| Rôles dans le sélecteur Stats | 1 à 25 ; plusieurs rôles possibles |
| Salons dans le sélecteur d'exclusions | Jusqu'à 25 |
| Personnes par page de tableau | 1 000 |
| Présences récentes affichées | 100 derniers segments de la période |
| Export CSV/JSON du dashboard | Jusqu'à 10 000 personnes |
| Export CSV/JSON dans Discord | Jusqu'à 1 000 personnes |
| Rafraîchissement du dashboard | Chaque minute ; bouton **Actualiser** disponible |

Les interruptions de Discord ou du bot peuvent créer des périodes sans données. Les observations déjà reçues peuvent
être reprises, mais une durée inconnue n'est pas reconstituée. Il n'existe pas d'annuaire complet ni de classement
prouvant l'inactivité d'un membre.

## Si quelque chose ne fonctionne pas

| Situation | Que faire ? |
| --- | --- |
| L'activation est bloquée | Un administrateur doit choisir des rôles membres réels et retirer `@everyone` de la sélection. |
| Vous ne pouvez pas modifier les rôles | Leur modification demande le niveau administrateur Discord, même si vous êtes officier. |
| Le dashboard ne propose aucun serveur | Vérifiez que PICKET est installé et actif dans le serveur, que vous en êtes membre et que vous utilisez la bonne instance. |
| Aucune activité n'apparaît | Vérifiez l'activation, les rôles ciblés, les salons exclus, votre préférence de suivi et la période choisie. |
| Vous ne voyez pas les données d'autres personnes | Choisissez **Activité du régiment** si vous êtes officier ou administrateur de ce serveur ; sinon, la vue reste personnelle. |
| Les chiffres sont en retard ou une interruption est indiquée | Consultez la dernière confirmation et réessayez **Actualiser** plus tard. Le temps non observé ne sera pas ajouté automatiquement. |
| Vos droits viennent de changer | Actualisez ou reconnectez-vous ; la liste des serveurs et l'accès Team peuvent mettre jusqu'à deux minutes à se renouveler. |
| Discord limite les vérifications d'accès | Les délais courts sont réessayés automatiquement. Pour un délai plus long, attendez le nombre de secondes affiché avant d'utiliser **Actualiser**. Les actions de confidentialité restent désactivées jusqu'au chargement ; votre préférence enregistrée ne change pas. |
| `/stats link` ne propose pas de lien sur une instance auto-hébergée | Son opérateur doit [configurer le dashboard](../self-hosting/configuration#statistiques-vocales-et-dashboard). |
| Un export est trop volumineux | Réduisez la période ou choisissez un salon ; aucun fichier partiel n'est présenté comme complet. |

## Ce que PICKET stocke

PICKET conserve les identifiants **serveur, utilisateur et salon**, les horodatages des événements vocaux et les
segments de présence. Les pseudos des participants suivis et noms des salons rendent les rapports lisibles.

Les noms des salons sont conservés entre les redémarrages du bot. Si seul un ID a été enregistré, PICKET récupère
le nom auprès de Discord lorsqu'il est disponible et met à jour les rapports existants. Un salon supprimé ou
inaccessible conserve son dernier nom connu ; l'ID reste affiché si aucun nom n'a jamais été disponible.
Une mise à jour du nom ne prolonge pas la rétention de l'historique.
Un état temporaire des humains connectés, rôles compris, permet de gérer les changements d'éligibilité et les reprises,
sans enregistrer un annuaire complet.

**Tout l'historique statistique et les rapports dérivés sont limités à 60 jours glissants.** Désactiver la collecte
laisse cet historique jusqu'à expiration. Les réglages et préférences de refus du suivi sont conservés séparément pour
respecter votre choix. L'effacement retire votre historique, ses contributions aux rapports et ses événements en attente.

L'historique statistique est exclu des sauvegardes standard pour qu'elles ne prolongent pas sa conservation. Les réglages
et préférences restent sauvegardés ; perdre le volume de base implique de perdre cet historique. Un administrateur peut
aussi exporter ou demander la suppression des données du serveur dans `/picket settings` → **Données**. Consultez la
[Politique de confidentialité](../legal/privacy) pour le cadre général de conservation.
