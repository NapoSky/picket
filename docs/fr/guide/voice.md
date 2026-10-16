# Vocaux éphémères

Un briefing, deux groupes de combat et une équipe logistique à réunir : créez les vocaux dont votre groupe a besoin,
puis laissez PICKET les retirer lorsqu'ils restent vides. Un canal encore occupé reste disponible, même si la
personne qui l'a demandé est partie.

Un officier prépare des **modèles** : catégorie de destination, nom du vocal, capacité et délai de nettoyage.
Les membres utilisent ensuite **`/voice create`** pour choisir leurs modèles et quantités, composer une file privée
et tout déployer ensemble. Le module est **activé par défaut** ; aucun salon de demandes dédié n'est nécessaire.

## Qui peut faire quoi ?

Les niveaux ci-dessous sont les accès **PICKET** configurés pour votre serveur, pas vos grades en jeu.

| Accès | Ce que vous pouvez faire |
| --- | --- |
| **Membre** | Préparer une file et déployer un ou plusieurs vocaux à partir des modèles disponibles. |
| **Officier** | Tout ce qu'un membre peut faire, plus gérer les modèles, régler la limite par déploiement, consulter les canaux ouverts et demander leur suppression s'ils sont vides. Activer ou désactiver le module dans `/picket settings`. |
| **Administrateur Discord** | Tout ce qu'un officier peut faire, plus gérer les rôles d'accès et exporter ou supprimer les données du serveur. |

Par défaut, tous les membres du serveur peuvent demander des vocaux, et les administrateurs peuvent configurer les
modèles. Un administrateur peut déléguer cette configuration à un rôle officier dans `/picket settings` →
**Permissions**. Consultez le [guide des permissions](./permissions) pour les détails.

## Vos premiers vocaux

Supposons que votre groupe ait besoin de deux canaux de combat et d'un canal logistique pour une opération.

1. **Un officier prépare les modèles** : ouvrez `/voice settings`,
   puis **Ajouter**. Choisissez la catégorie `Opérations`, puis le nom de vocal `Combat`,
   une capacité de `10` personnes et un délai de `15 min`. Créez ensuite un modèle `Logistique` de la même manière.
2. **Un membre lance `/voice create`**, depuis n'importe quel salon du serveur. Le panneau est privé et la file vide.
3. **Choisissez `Combat`, puis la quantité `2`** et cliquez sur **Ajouter × 2**. Deux vocaux sont ajoutés à la file,
   sans être créés à ce stade.
4. **Choisissez `Logistique`, puis la quantité `1`** et cliquez sur **Ajouter × 1**. La file contient maintenant
   trois vocaux, répartis entre les deux modèles.
5. Cliquez sur **Déployer les 3 canaux**. Le suivi du déploiement s'affiche ; **Actualiser** permet de consulter
   les résultats et les liens des vocaux créés. Les noms reçoivent automatiquement un numéro.

Le bot doit pouvoir **Voir les salons** et **Gérer les salons** dans les catégories choisies et les vocaux créés.
Les vocaux héritent des permissions de leur catégorie. Sur une installation existante, un administrateur doit
accorder **Gérer les salons** au rôle du bot si nécessaire ; modifier les permissions d'installation de l'application
ne met pas à jour les rôles déjà présents.

PICKET ne demande pas **Se connecter**, **Parler**, **Déplacer les membres**, **Voir le journal d'audit** ou
**Administrateur** pour cette fonctionnalité. Il ne rejoint pas l'appel et ne reçoit aucun audio.

## Préparer les vocaux de votre groupe

### Composer la file

Le panneau présente les modèles accessibles, la quantité à ajouter et votre file actuelle. Les vocaux ne sont créés
qu'après votre clic sur **Déployer** : vous pouvez préparer une seule entrée ou combiner plusieurs modèles.

![Panneau privé de préparation des vocaux en anglais : modèle Logistics sélectionné, quantité 1, file contenant deux Combat et un Logistics, et bouton de déploiement des trois canaux.](/images/voice-queue-example.png)

*Illustration du panneau avec les textes du bot en anglais et des modèles fictifs. La file contient trois vocaux ;
ils ne sont pas encore créés. La disposition peut varier selon votre client Discord.*

| Vous voulez… | Faites ceci |
| --- | --- |
| Demander un seul vocal | Choisissez un modèle, gardez la quantité 1, ajoutez-le à la file et déployez. |
| Combiner plusieurs modèles | Choisissez chaque modèle et sa quantité, puis ajoutez-les avant de déployer. |
| Augmenter une entrée déjà préparée | Ajoutez de nouveau le même modèle : sa quantité augmente. |
| Modifier ou retirer une entrée | Choisissez-la dans **Choisir une entrée à modifier ou retirer**, puis saisissez la nouvelle quantité. `0` retire cette entrée. |
| Recommencer la préparation | Cliquez sur **Vider la file**. **Annuler** abandonne la préparation et supprime son message privé sans créer de vocal. |

Seules les destinations que vous pouvez voir et rejoindre sont proposées. Le panneau est réservé à la personne
qui l'ouvre et expire après **15 minutes d'inactivité**. Relancez `/voice create` pour recommencer. Un ancien bouton
ne permet pas de répéter un déploiement déjà confirmé.

### Retrouver les canaux créés

Après confirmation, **Actualiser** affiche l'état de chaque vocal : en attente, création en cours, ouvert, non créé
ou création à vérifier avec un officier. Les canaux créés ont un lien permettant de les rejoindre.
**Nouveau déploiement** ouvre une nouvelle file vide.

Si un officier a modifié un modèle pendant votre préparation, ou si vos accès ont changé, PICKET bloque la
confirmation : actualisez le panneau et recréez les entrées concernées.

### Laisser les canaux se nettoyer

Un vocal créé mais jamais rejoint commence son délai de nettoyage dès sa création. Dès qu'une personne ou un bot
est présent, le compte à rebours est annulé. Le départ du dernier occupant déclenche **un délai complet**.
Avec un délai de 15 minutes, une arrivée après 10 minutes d'inoccupation annule donc les 10 minutes déjà écoulées.

Le départ du créateur n'entraîne pas la suppression d'un vocal occupé par d'autres. Après une interruption du bot,
un canal constaté vide reçoit un nouveau délai complet si la continuité du suivi n'est pas établie : son nettoyage
peut alors prendre plus de temps.

## Adapter les vocaux à votre organisation

Un officier ouvre `/voice settings`. Ce panneau privé regroupe les modèles,
le plafond par demande et les canaux suivis.
Le bouton **Réglages PICKET** permet de revenir à la configuration générale du serveur.

| Écran ou action | Ce que vous pouvez régler |
| --- | --- |
| **Accueil** | Consulter les modèles, la limite par déploiement et le nombre de canaux ouverts ou réservés. Sélectionner un modèle pour voir ses options. |
| **Ajouter / Modifier / Dupliquer** | Remplir les quatre champs, dans cet ordre : catégorie de destination, nom du canal vocal, capacité et délai de nettoyage. Le nom du vocal est aussi celui du modèle proposé aux membres. Catégorie et délai utilisent des sélecteurs. |
| **Retirer** | Retirer le modèle après confirmation. Les vocaux déjà créés gardent leurs réglages et leur nettoyage. |
| **Limite par déploiement (1–10)** | Choisir le nombre total de vocaux qu'une personne peut déployer en une fois. |
| **Canaux ouverts** | Consulter les canaux suivis et leurs présences. Sélectionner un canal, puis **Supprimer si vide** pour demander son retrait anticipé. |

Les changements de modèle s'appliquent aux prochaines créations ; ils ne modifient pas les canaux déjà ouverts.
La suppression anticipée est refusée tant que le canal contient un occupant.

::: details Réglages disponibles et valeurs par défaut

| Réglage | Choix | Défaut |
| --- | --- | --- |
| Catégorie de destination | Une catégorie Discord accessible. | À choisir |
| Nom du vocal et du modèle | Nom unique sur le serveur, jusqu'à 90 caractères ; PICKET ajoute un numéro aux vocaux créés. | À renseigner |
| Capacité | De 1 à 99 personnes. `0` et la capacité illimitée sont refusés. | 99 |
| Délai continuellement vide avant suppression | 1, 5, 10, 15, 20 ou 30 minutes. | 15 min |
| Canaux par déploiement, tous modèles confondus | De 1 à 10. | 6 |

:::

Pour désactiver les nouvelles demandes, utilisez `/picket settings`. Les créations encore en attente sont annulées ;
**le nettoyage des vocaux existants continue**. Les modèles restent enregistrés pour une réactivation ultérieure.

## Limites

| Limite | Valeur |
| --- | --- |
| Modèles par serveur, duplications comprises | 10 |
| Vocaux par déploiement, tous modèles confondus | 6 par défaut ; réglable jusqu'à 10 |
| Vocaux ouverts ou réservés sur le serveur | 15, demandes de tous les membres confondues |
| Capacité d'un vocal | De 1 à 99 personnes |
| Délai de nettoyage | 30 minutes maximum après le départ du dernier occupant, hors interruption du suivi |
| Validité d'une préparation privée | 15 minutes d'inactivité |

**Deux canaux Combat et un canal Logistique comptent pour trois vocaux**, dans la demande comme dans le plafond du
serveur. Les créations en attente, en cours ou à vérifier réservent aussi une place. Les demandes simultanées
partagent ce plafond ; une demande qui dépasse les places restantes est refusée avant sa mise en création.

## Si quelque chose ne fonctionne pas

| Situation | Que faire ? |
| --- | --- |
| Aucun modèle n'est proposé | Demandez à un officier de créer un modèle, puis vérifiez que vous pouvez voir et rejoindre sa destination et que le bot peut la gérer. |
| Une commande ou un bouton vous est refusé | Vérifiez vos rôles PICKET, l'activation du module et les permissions Discord de la destination. |
| La préparation a expiré ou changé | Relancez `/voice create`, ou rouvrez les réglages. Si un modèle a changé, recréez les entrées concernées. |
| Le serveur a atteint sa limite | Attendez le nettoyage des vocaux vides, ou demandez à un officier de consulter **Canaux ouverts**. Les créations réservées comptent aussi. |
| Un canal vide reste présent | Vérifiez que le délai est écoulé et qu'aucun bot n'est connecté. Une panne ou une perte de permissions suspend le nettoyage ; la reprise peut redonner un délai complet. |
| Un canal a été supprimé manuellement | PICKET libère sa place après avoir confirmé son absence. Aucune intervention en base n'est nécessaire. |
| Une création est à vérifier | Un officier vérifie les canaux dans Discord, puis peut sélectionner l'entrée dans **Canaux ouverts** et **Clore le suivi** après confirmation. Cela libère la réservation sans supprimer de canal Discord. |

::: details Comment PICKET reprend après un arrêt

Les demandes confirmées et le suivi des canaux sont persistants. Après redémarrage, PICKET vérifie les canaux connus
et reconstruit les présences avant de nettoyer. Une erreur de permissions n'est pas traitée comme un canal absent.

Une création peut réussir chez Discord juste avant que PICKET perde sa réponse et ne puisse enregistrer l'identifiant
du canal. Elle passe alors **à vérifier**, sans nouvelle tentative automatique qui risquerait un doublon. PICKET
ne reconnaît pas un canal à son seul nom et ne consulte pas le journal d'audit de Discord.

Discord ne propose pas de suppression atomique « uniquement si vide ». PICKET revérifie les présences juste avant
la suppression ; une arrivée exactement simultanée reste une course possible côté plateforme.

:::

## Ce que PICKET stocke

PICKET enregistre les modèles et leurs réglages, les préparations privées, les demandes confirmées et les
informations nécessaires au nettoyage : identifiants des canaux, présences actuelles, échéances et dernières
vérifications. Ce suivi fonctionne indépendamment des [statistiques vocales](./stats), même si leur collecte est
désactivée. Il n'ajoute pas d'historique des déplacements et ne contient aucun audio.

Les préparations expirent après **15 minutes d'inactivité**. Les enregistrements opérationnels terminés deviennent
nettoyables après **24 heures** ; une création à vérifier garde sa réservation jusqu'à sa résolution. Les modèles
restent enregistrés jusqu'à leur retrait ou à la suppression des données du serveur.

Un administrateur peut exporter les données du serveur ou demander leur suppression dans `/picket settings` →
**Données**. Pour cette fonctionnalité, l'export inclut **uniquement les noms des modèles actuels**. Les options,
préparations, déploiements, présences et dates de vérification sont exclus : cet export informe sur les modèles
enregistrés et ne permet pas de les restaurer. Toutes les données du module suivent le cycle de suppression du
serveur. Consultez la [Politique de confidentialité](../legal/privacy) pour le cadre général de conservation.
