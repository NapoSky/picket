# Journal de guerre

PICKET suit l'API publique de Foxhole et publie les changements dans un salon textuel classique. La collecte est
mutualisée entre les serveurs ; chacun choisit sa couverture géographique. Le module est **désactivé par défaut**.

## Configurer l'abonnement

Un officier lance `/warlog settings`. Dans le panneau privé :

1. Choisissez un **salon textuel classique** où PICKET peut Voir le salon, Envoyer des messages et Intégrer des liens.
   Les salons d'annonces, threads, forums et salons vocaux sont refusés.
2. Sélectionnez **une à trois zones** : Îles Ouest, Côte Ouest, Centre, Côte Est ou Îles Est. Ces cinq zones regroupent
   les 53 régions connues du jeu. Cliquez à nouveau sur une zone pour la retirer.
3. Choisissez la **faction de référence** : Neutre (par défaut), Coloniaux ou Wardens. Ce choix détermine les couleurs
   des alertes spéciales, sans filtrer les événements par faction. Il est conservé entre les guerres.
4. Cliquez sur **Confirmer et activer**. La guerre actuelle doit être disponible pour activer l'abonnement.

Un canal de destination est disponible par serveur. Plusieurs zones alimentent ce même canal. Le panneau est réservé
à son propriétaire et expire après 15 minutes ; relancez la commande si nécessaire. La langue suit le réglage du serveur,
puis la langue du serveur Discord enregistrée au choix du canal, puis l'anglais.

Chaque événement ordinaire est un message distinct, silencieux, sur une ligne : faction, horodatage du jeu, région,
structure et lieu. Les constructions initiales sont omises ; améliorations et captures sont publiées. Les Storm Cannons,
Intelligence Centers et Weather Stations dont la construction est observée reçoivent des notifications estimées de
séchage après respectivement 48, 24 et 24 heures. Le texte indique que le béton **peut avoir séché**, car l'API ne donne
pas l'heure réelle de construction.

## Alertes spéciales et couleurs

Les événements suivants sont publiés dans un embed individuel, avec région, lieu, heure du jeu et perspective :

| Événement | Format |
| --- | --- |
| Storm Cannon construit ou détruit | Embed |
| Site de lancement détecté, armé, désarmé ou détruit | Embed |
| Cible nucléaire détectée ou retirée | Embed |
| Impact nucléaire et retrait de son marqueur | Embed |
| Structure incendiée | Embed par structure |
| Fin de guerre | Embed de la couleur du vainqueur |
| Captures, pertes, améliorations, IC/WS et séchage du béton | Ligne de texte |

Le vert indique un événement **favorable** au serveur, le rouge un événement **défavorable**. Un site de lancement
allié armé est vert ; un site ennemi armé est rouge. La destruction d'un Storm Cannon allié est rouge, celle d'un
Storm Cannon ennemi est verte. Pour une structure incendiée, la faction désigne son ancien propriétaire, pas le lanceur.
Le pied de page précise « Allié / Ennemi » et « Favorable / Défavorable » pour rendre le sens lisible sans la couleur.

Avec la perspective Neutre ou une faction d'événement inconnue, ces alertes sont grises. Le retrait d'un ancien marqueur
d'impact est toujours gris, car il n'indique pas un nouveau résultat militaire. La fin de guerre utilise la couleur du
vainqueur indépendamment de la perspective. Aucun regroupement d'impacts ou de structures incendiées n'est effectué :
un événement reste un message. Les emojis Colonial et Warden identifient toujours la faction réelle de l'événement.
Tous les messages, embeds compris, sont silencieux.

## Changer de couverture ou suspendre

Changer le canal, les zones ou la faction de référence annule les messages encore en attente de l'ancienne configuration. Retirer la dernière
zone désactive aussi l'abonnement. Désactiver puis réactiver reprend les **nouveaux événements uniquement**, sans rejouer
la période désactivée. Un appel déjà parti vers Discord peut encore aboutir après un changement de configuration.

## Confirmer à chaque nouvelle guerre

Au début d'une nouvelle guerre, les abonnements deviennent inactifs. Les serveurs auparavant abonnés reçoivent une
invitation unique dans leur ancien canal à ouvrir `/warlog settings`. Le canal et les zones restent préremplis : vérifiez
ou modifiez-les, puis confirmez et activez pour la guerre actuelle. Aucun rappel périodique ni rejeu rétroactif.
La faction de référence reste conservée et n'a pas à être choisie à nouveau.

Un redémarrage pendant la même guerre ne demande pas une nouvelle confirmation. Une nouvelle guerre découverte après
une panne exige également un renouvellement. Les resets facultatifs des tableaux se règlent séparément dans
`/timers settings` et ne dépendent pas du renouvellement de l'abonnement au war-log.

## Interruptions

Si la collecte échoue, PICKET suspend le flux et réessaie. Il recharge la carte publique complète comme nouvelle
référence, puis publie les changements suivants. Les changements de la période d'arrêt et les messages en attente avant
la reprise ne sont pas rejoués. Une réponse partielle ne signifie jamais que ses structures ont disparu.

L'objectif de livraison d'un événement isolé détecté est de deux minutes à la volumétrie supportée, en fonctionnement
normal. Cela exclut le temps précédant l'exposition du changement par l'API et ne couvre pas les pannes, les canaux
inaccessibles ou une surcharge durable. Les envois sont étalés pour partager le budget Discord avec les timers et les
autres fonctions du bot.

Si le canal est supprimé, converti en type non accepté ou refuse les messages par manque de permissions, son abonnement
est suspendu. Choisissez un canal valide puis réactivez. `/warlog settings` reste accessible quand l'abonnement est arrêté.

## Données conservées

L'état public du jeu et les événements enregistrés sont conservés pour la guerre courante et la précédente observée.
Les données du serveur comprennent canal, zones, faction de référence, langue, activation pour une guerre, état des livraisons et audits de
configuration. L'export et la suppression dans `/picket settings` les incluent. Les données publiques partagées sont
indépendantes de la suppression d'un serveur ; les messages Discord ne sont pas supprimés automatiquement. Consultez
la [Politique de confidentialité](../legal/privacy).

Pour mettre les données de jeu à jour, comparez les régions actives et types d'icône avec la documentation officielle
de la War API, modifiez `packages/game-data/src/domain/war-catalog.ts`, incrémentez `WAR_DATA_VERSION`, puis lancez les
tests du catalogue et des transitions.
