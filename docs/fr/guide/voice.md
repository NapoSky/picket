# Vocaux éphémères

PICKET 1.1 permet aux membres de composer une file privée de modèles définis par les officiers, puis de déployer un ou plusieurs canaux avec `/picket voice`. Aucun salon de demandes dédié n’est nécessaire. Le module est activé par défaut ; un officier doit d’abord créer un modèle.

## Configurer les modèles

Ouvre `/picket settings` → **Vocaux éphémères** → **Configurer**. Les officiers peuvent ajouter, modifier, dupliquer ou retirer des modèles, avec **10 modèles maximum par serveur**. Chaque modèle définit :

- Son nom, affiché aux membres.
- Une catégorie Discord de destination.
- Le nom du canal vocal ; PICKET ajoute automatiquement un numéro.
- Une capacité de **1 à 99 personnes**, **99 par défaut**. La capacité illimitée est refusée.
- Une période continuellement vide de **1, 5, 10, 15, 20 ou 30 minutes**, **15 par défaut**.

La modale utilise les sélecteurs natifs de catégorie et de délai. Modifier ou retirer un modèle ne change pas les canaux existants. Le retrait demande confirmation.

Le plafond par déploiement est de **6 canaux au total par défaut**, réglable par un officier entre 1 et **10**. Le serveur peut avoir **15 canaux ouverts ou réservés maximum**, demandes en cours ou à vérifier comprises. Les demandes simultanées partagent ce quota.

## Préparer et déployer

1. Lance `/picket voice`. La file privée commence vide.
2. Choisis un modèle. Sa catégorie, sa capacité et son délai apparaissent.
3. Choisis la quantité, puis **Ajouter**. La sélection revient à zéro pour préparer l’entrée suivante.
4. Répète pour les autres modèles. Ajouter de nouveau le même modèle augmente sa quantité.
5. Le sélecteur de la file permet de modifier une quantité ; 0 retire cette entrée de la file. Cela n’autorise pas une capacité de vocal à 0.
6. Lorsque la file convient, clique sur **Déployer les N canaux**.

La recherche filtre le sélecteur de modèles. Seules les destinations que le membre peut voir et rejoindre sont proposées. **Vider la file** réinitialise la demande ; **Annuler** abandonne la préparation. Les contrôles expirent après 15 minutes d’inactivité. Chaque préparation est liée à son serveur et à son auteur ; un ancien contrôle ne peut pas répéter un déploiement.

Le déploiement confirmé est enregistré durablement. **Actualiser** affiche chaque canal en attente, en cours de création, ouvert, non créé ou à vérifier, avec les liens des canaux créés. **Nouveau déploiement** repart sur une file vide. Un modèle modifié ou une perte d’accès bloque la confirmation ; recrée les entrées concernées.

## Nettoyage et reprise

Un canal créé mais jamais rejoint démarre son délai à la création. Tout occupant, bot compris, annule le compte à rebours. Le départ du dernier occupant déclenche un délai complet. Le départ du créateur n’entraîne pas la suppression d’un canal encore occupé.

Les officiers disposent de **Canaux ouverts** et de **Supprimer si vide**. Désactiver le module bloque les nouveaux déploiements et annule les créations encore en attente ; les canaux existants conservent leur cycle de nettoyage.

Le suivi et les demandes confirmées sont persistés en PostgreSQL. Après redémarrage, PICKET vérifie les canaux enregistrés et reconstruit un état fiable des présences avant de nettoyer. Un canal confirmé absent libère sa place. Une perte de permissions ou une panne Discord suspend le nettoyage. Si la continuité n’est pas établie, un canal constaté vide reçoit un délai complet ; une panne peut donc prolonger sa conservation.

Une création peut réussir chez Discord juste avant que PICKET perde à la fois sa réponse et la possibilité d’enregistrer son identifiant. L’opération passe alors **à vérifier** et n’est pas répétée automatiquement. PICKET ne reconnaît pas un canal à son seul nom. Un officier peut devoir résoudre ce cas exceptionnel. Aucun accès au journal d’audit n’est utilisé.

Discord ne propose pas de suppression atomique « uniquement si vide » : PICKET revérifie les présences fiables juste avant la suppression, mais une arrivée exactement simultanée reste une course possible côté plateforme.

## Permissions et confidentialité

PICKET doit disposer de **Gérer les salons** et **Voir les salons** sur les destinations utilisées. Pour une installation existante, un administrateur doit accorder Gérer les salons au rôle du bot ; modifier les réglages d’installation ne change pas les rôles existants. Les canaux héritent des permissions de leur catégorie. Si les permissions effectives empêchent la gestion d’un vocal, la destination est indisponible.

Cette fonctionnalité ne demande ni **Se connecter**, ni **Parler**, ni **Déplacer les membres**, ni **Voir le journal d’audit**, ni **Administrateur**, ni nouvel intent. Elle réutilise `Guilds` et `GuildVoiceStates`, indépendamment du module Stats optionnel. PICKET ne rejoint pas l’appel et ne reçoit aucun audio.

La présence opérationnelle contient les identifiants nécessaires pour reconnaître les arrivées et départs, sans historique supplémentaire des déplacements. Les préparations expirent après 15 minutes ; les enregistrements opérationnels terminés deviennent nettoyables après 24 heures. Les créations incertaines conservent leur réservation jusqu’à résolution. Toutes ces données suivent le cycle de suppression du serveur.

L’export de données du serveur inclut **uniquement les noms des modèles actuels** pour cette fonctionnalité. Options des modèles, préparations, déploiements, présences, dates de vérification et état du nettoyage sont exclus. Cet export est informatif et ne constitue pas une sauvegarde de modèles.

Un officier peut sélectionner une création incertaine dans **Canaux ouverts**, puis utiliser **Clore le suivi** après vérification dans Discord. La confirmation libère la réservation et ne supprime aucun canal Discord.
