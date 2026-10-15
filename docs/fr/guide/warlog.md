# Journal de guerre

Suivre les captures, les pertes et l'activité nucléaire sans quitter Discord : PICKET publie les événements de guerre
dans le salon de votre groupe, pour les zones que vous choisissez. Les événements courants tiennent sur une ligne ;
les alertes spéciales apparaissent dans des cartes colorées pour les repérer facilement.

Un officier configure **un abonnement par serveur** avec `/warlog settings`. Il est **désactivé par défaut** et reçoit
les nouveaux événements une fois activé, sans rejouer les changements précédents.

## Qui peut faire quoi ?

Lire le journal demande uniquement l'accès au salon Discord. La configuration utilise les niveaux d'accès **PICKET**
définis pour votre serveur, pas vos grades en jeu.

| Accès | Ce que vous pouvez faire |
| --- | --- |
| **Toute personne pouvant lire le salon** | Suivre les événements publiés. Aucune commande ni aucun bouton à utiliser. |
| **Officier** | Choisir le salon, les zones et la faction de référence ; activer ou suspendre l'abonnement. |
| **Administrateur Discord** | Tout ce qu'un officier peut faire, plus gérer les rôles d'accès et exporter ou supprimer les données du serveur. |

Par défaut, les administrateurs peuvent configurer le journal. Un administrateur peut accorder l'accès officier dans
`/picket settings` → **Permissions**. Consultez le [guide des permissions](./permissions) pour les détails.

## Votre premier abonnement

Supposons que votre groupe veuille suivre la Côte Ouest et le Centre.

1. **Un officier lance `/warlog settings`**. Le panneau privé peut être ouvert depuis n'importe quel salon du serveur.
2. **Choisissez la destination** : un salon textuel classique, par exemple `#war-log`.
3. **Choisissez votre faction de référence** : Neutre (par défaut), Coloniaux ou Wardens. Sélectionnez ensuite
   **Côte Ouest** et **Centre**.
4. Cliquez sur **Confirmer et activer**. Les nouveaux événements de ces zones apparaîtront dans `#war-log`.

Le bot doit pouvoir **Voir le salon**, **Envoyer des messages** et **Intégrer des liens** dans la destination. Les salons
d'annonces, threads, forums et salons vocaux sont refusés. La guerre actuelle doit être disponible pour l'activation.

## Suivre les événements dans le salon

### Lire les messages

Chaque événement produit **un message silencieux**, sans ping. Une ligne de texte indique l'icône de faction, l'heure
de l'événement, la région, l'action, la structure et le lieu. Les heures sont affichées par votre client Discord.

![Messages du war-log en anglais dans un salon Discord : captures sur une ligne, lancement Warden allié en bleu, cible ennemie en rouge et destruction d'un Storm Cannon ennemi en rouge.](/images/warlog-channel-example.png)

*Illustration avec les messages du bot en anglais et Wardens comme faction de référence du serveur. Les événements
sont fictifs ; la disposition peut varier selon votre client Discord.*

| Événement | Affichage |
| --- | --- |
| Captures, pertes, améliorations et structures courantes, dont Intelligence Centers et Weather Stations | Une ligne de texte |
| Storm Cannon construit ou détruit | Une carte colorée (embed) |
| Site de lancement, cible nucléaire, impact ou structure incendiée | Une carte par événement |
| Séchage estimé du béton | Une ligne de texte |
| Fin de guerre | Une carte selon la faction du vainqueur et votre référence |

Les notifications de construction initiale en cours des structures courantes sont omises. Les améliorations et les
événements de construction terminée sont publiés. Un impact et les structures incendiées restent des messages séparés.

### Comprendre les couleurs

**Les Wardens alliés sont en bleu, les Coloniaux alliés en vert et les ennemis toujours en rouge.** Votre faction de
référence détermine quel camp est allié :

| Faction de référence | Événement Warden | Événement Colonial |
| --- | --- | --- |
| Wardens | Bleu : allié | Rouge : ennemi |
| Coloniaux | Rouge : ennemi | Vert : allié |
| Neutre | Gris | Gris |

Cette règle s'applique à **tous les embeds**, y compris les destructions, les désarmements et le retrait d'un marqueur
d'impact. Un Storm Cannon Warden détruit reste bleu pour un serveur Warden ; un Storm Cannon Colonial détruit reste rouge.

Le pied de page précise aussi **Allié / Ennemi / Neutre**. Les icônes identifient toujours la
faction concernée par l'événement. Choisir votre faction ne **filtre pas** les événements de l'autre camp.

Avec **Neutre** sélectionné, ou une faction d'événement inconnue, les embeds sont gris. Pour une structure incendiée,
la faction désigne son ancien propriétaire, pas le lanceur. En fin de guerre, la faction concernée est celle du vainqueur.

### Suivre le séchage du béton

Quand PICKET observe une construction, il prépare une notification de séchage estimé :

| Structure | Délai après détection |
| --- | --- |
| Storm Cannon | 48 heures |
| Intelligence Center | 24 heures |
| Weather Station | 24 heures |

Le message indique que le béton **peut avoir séché**. Les données publiques de Foxhole ne donnent pas l'heure réelle
de construction : c'est donc une estimation, pas une confirmation du jeu. La destruction annule la notification.

## Adapter l'abonnement à votre groupe

### Choisir les zones et changer les réglages

Un officier ouvre `/warlog settings`. Les changements s'appliquent à **tout le serveur**. Plusieurs zones alimentent
le même salon ; cliquez à nouveau sur une zone sélectionnée pour la retirer.

Cliquez sur **Voir les régions des zones** pour consulter les régions des cinq zones, puis revenir aux réglages.
Le bouton **Coloniaux** sélectionné est vert ; le bouton **Wardens** sélectionné est bleu.

Le journal de guerre figure aussi à côté des Timers et des Todolists sur l'accueil de `/picket settings`.
**Activer** ouvre son panneau pour vérifier le salon et les zones avant de confirmer.
**Désactiver** demande confirmation, suspend l'abonnement et annule les messages en attente.

Une fois activé, **Configurer** rouvre le panneau depuis `/picket settings` sans changer son activation.
Après une ouverture depuis PICKET, le panneau et la liste des régions proposent **Réglages PICKET** pour revenir
à l'accueil dans le même message privé. Les modifications enregistrées sont conservées. Ce bouton n'apparaît pas
quand le panneau est ouvert directement avec `/warlog settings`.

::: details Réglages disponibles et valeurs par défaut

| Réglage | Choix | Par défaut |
| --- | --- | --- |
| Destination | Un salon textuel classique. | Aucun |
| Zones | Une à trois parmi Îles Ouest, Côte Ouest, Centre, Côte Est et Îles Est. | Aucune |
| Faction de référence | Neutre, Coloniaux ou Wardens. | Neutre |
| Abonnement | Activé ou désactivé ; l'activation demande un salon et des zones. | Désactivé |

:::

Changer le salon, les zones ou la faction prend effet immédiatement et annule les messages encore en attente de
l'ancienne configuration. Un envoi déjà parti peut encore aboutir. Retirer la dernière zone suspend l'abonnement.

Cliquez sur **Désactiver** pour suspendre, puis sur **Confirmer et activer** pour reprendre. PICKET envoie uniquement
les **nouveaux événements** à la reprise. Le panneau appartient à la personne qui l'ouvre et expire après 15 minutes
sans mise à jour ; relancez la commande si nécessaire. Les messages suivent la langue du serveur configurée dans
`/picket settings`, avec la langue du serveur Discord puis l'anglais en repli.

### Commencer la guerre suivante

À chaque nouvelle guerre, PICKET suspend les abonnements actifs et publie **une invitation unique à renouveler** dans
leur ancien salon. Ouvrez `/warlog settings`, vérifiez ou changez les zones, puis confirmez et activez à nouveau.

Le **salon, les zones et la faction de référence restent enregistrés**. Vous n'avez pas à choisir à nouveau votre
faction. Aucun rappel périodique ni aucun événement antérieur au renouvellement n'est envoyé. Un redémarrage pendant
la même guerre ne demande pas de renouvellement.

Les resets facultatifs des tableaux de timers se règlent séparément dans `/timers settings` → **Gestion du tableau**.
Ils sont désactivés par défaut et ne dépendent pas du renouvellement du journal. Consultez le [guide des timers](./timers).

## Limites

| Limite | Valeur |
| --- | --- |
| Salons de destination par serveur | 1 |
| Zones suivies | 1 à 3 parmi 5 |
| Regroupement des événements | Aucun : un événement par message |
| Notifications | Toujours silencieuses |
| Rattrapage après une pause ou une panne de collecte | Aucun |

En fonctionnement normal, PICKET vise une livraison d'un événement isolé dans les **deux minutes après sa détection**.
Ce délai n'inclut pas l'attente avant que Foxhole publie le changement. Une panne, un salon inaccessible ou une
surcharge durable peuvent retarder les envois.

## Si quelque chose ne fonctionne pas

| Situation | Que faire ? |
| --- | --- |
| Vous ne pouvez pas ouvrir ou modifier les réglages | Vérifiez votre accès officier PICKET et si le serveur est suspendu. |
| La destination est refusée | Choisissez un salon textuel classique et vérifiez les permissions Voir le salon, Envoyer des messages et Intégrer des liens du bot. |
| La guerre actuelle n'est pas disponible | Réessayez l'activation plus tard. Vous pouvez déjà enregistrer le salon, les zones et la faction. |
| Aucun événement n'apparaît | Vérifiez que l'abonnement est activé pour la guerre actuelle et couvre les zones souhaitées. |
| Le salon a été supprimé, converti ou est devenu inaccessible | La publication est suspendue. Rétablissez les permissions ou choisissez un salon valide, puis réactivez. |
| Les événements sont retardés | Les erreurs Discord temporaires sont réessayées ; les messages en attente peuvent arriver plus tard. |
| Il manque des événements après une panne ou un redémarrage | PICKET actualise sa vue de la carte et reprend avec les changements suivants. Les événements manqués ne sont pas rejoués. |
| Une nouvelle guerre a commencé et les messages ont cessé | Ouvrez `/warlog settings` et renouvelez l'abonnement. Votre faction de référence est conservée. |

## Ce que PICKET stocke

PICKET enregistre le **salon, les zones, la faction de référence, la langue et l'état de l'abonnement** du serveur,
les informations de livraison et les audits de configuration. Un administrateur peut exporter ces données ou demander
leur suppression dans `/picket settings` → **Données**. La suppression des données du bot ne supprime pas automatiquement
les messages Discord.

Les observations publiques du jeu et les événements enregistrés sont partagés entre les serveurs et conservés pour la
**guerre courante et la précédente observée**. Supprimer les données d'un serveur n'efface pas cet historique de jeu
partagé. Consultez la [Politique de confidentialité](../legal/privacy) pour le cadre général de conservation.
