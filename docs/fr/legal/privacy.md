# Politique de confidentialité

Date d'effet : 14 octobre 2026.

Cette politique décrit les données traitées par l'instance officielle de PICKET (l'application Discord « PICKET » et le
site `docs.picket-foxhole.com`). Elle s'applique avec les [Conditions d'utilisation](./terms) et la
[Politique de confidentialité](https://discord.com/privacy) de Discord.

::: warning Instances auto-hébergées
Chacun peut exploiter sa propre copie de PICKET. Cette politique ne couvre que l'instance officielle. L'opérateur d'une
autre instance en est le responsable de traitement et doit publier sa propre politique.
:::

## Responsable

Le responsable de traitement est NapoSky, particulier établi en France, qui exploite l'instance officielle comme un projet
communautaire non commercial.

Pour poser une question, exercer un droit ou signaler un problème, ouvrez un ticket sur
[github.com/NapoSky/picket/issues](https://github.com/NapoSky/picket/issues). Les tickets sont publics : n'y mettez pas de
donnée personnelle. Pour tout sujet sensible, utilisez un
[signalement privé](https://github.com/NapoSky/picket/security/advisories/new).

## Ce que PICKET traite

| Donnée | Pourquoi | Conservation |
| --- | --- | --- |
| Identifiant du serveur et réglages (langue, fuseau horaire, fonctionnalités activées) | Faire fonctionner le bot | Tant que le bot est sur le serveur, puis la période de rétention |
| Identifiants des rôles rattachés aux niveaux officier et membre | Contrôler l'accès | Idem |
| Journal d'audit : qui a changé quoi, quand, avant et après (identifiant d'utilisateur Discord) | Traçabilité | Idem |
| Tableaux de timers : canal, réglages (seuils d'alerte, identifiants des rôles notifiés, limites) et identifiants des messages publiés par PICKET | Afficher et mettre à jour le tableau | Idem |
| Timers : type, nom, code, lieu, propriétaire (identifiant d'utilisateur Discord), début et durée, tels que saisis par les membres | Afficher les comptes à rebours et envoyer les alertes | Idem, ou jusqu'au nettoyage ou à la purge du timer |
| Historique des timers : qui a ajouté, rafraîchi, barré ou nettoyé quel timer, et quand (identifiant d'utilisateur Discord) | Traçabilité | Idem |
| Alertes envoyées pour chaque timer | Ne jamais envoyer deux fois la même alerte | Idem |
| Identifiant de chaque interaction traitée et son serveur | Ne pas traiter deux fois la même commande | 7 jours |
| Journaux de l'application : identifiants de serveur, d'utilisateur, de canal et de message pour chaque création et chaque clic de todolist ou de timer, jamais le contenu de la liste ni les noms de timers | Exploiter, sécuriser et dépanner le service | 30 jours |
| Diagnostics opérationnels distincts : horodatages, service/version, événements techniques, durées, nombres agrégés d'échecs et consommation des ressources ; sans identifiants Discord ni contenu utilisateur | Détecter les pannes et maintenir la disponibilité | 30 jours |
| Abonnement au war-log : canal, zones choisies, faction de référence, langue, activation pour une guerre et audits de configuration | Publier les événements publics du jeu demandés | Tant que le bot est sur le serveur, puis la période de rétention |
| Livraisons du war-log et suivi des resets facultatifs des timers | Contrôler la publication et éviter les actions répétées | Idem, avec nettoyage des livraisons terminées pendant la collecte |
| Événements vocaux éligibles et segments de présence : identifiants serveur/utilisateur/salon et horodatages | Produire les statistiques activées dans le serveur | 60 jours glissants maximum |
| Pseudos des participants vocaux et noms des salons | Rendre les rapports lisibles | Au plus 60 jours depuis leur dernière activité observée |
| État temporaire des humains connectés en vocal, rôles compris | Gérer l’éligibilité et la reprise Gateway sans annuaire complet | Jusqu’à déconnexion, exclusion ou expiration ; au plus 60 jours |
| Préférences de refus du suivi et bornes d’effacement | Respecter les oppositions et empêcher un rejeu tardif de restaurer les données effacées | Réglages jusqu’à suppression de la guilde |
| Identité du dashboard et tokens OAuth chiffrés | Authentifier via Discord et vérifier l’appartenance | Expiration de session, huit heures maximum ; état OAuth dix minutes |
| Sauvegardes de la base contenant les données ci-dessus | Se rétablir après une panne | 30 jours au plus |

L’état public de Foxhole et les événements enregistrés sont partagés entre les abonnements et conservés pour la guerre courante et la précédente observée. Ils contiennent structures, coordonnées, factions et horodatages du jeu, sans identifiants de membres Discord. La suppression d’un serveur n’efface pas cet historique public partagé.

Discord envoie à PICKET les identifiants du serveur, du canal, de l'utilisateur et des rôles concernés par chaque commande
ou clic de bouton. Ils servent à répondre à cette interaction et à contrôler les permissions. Seules les données listées
ci-dessus sont conservées.

Les noms et les codes saisis dans un timer sont visibles de toute personne qui peut lire le canal et sont conservés tels
que saisis : il est demandé aux membres de n'y mettre aucune donnée personnelle.

### Ce que PICKET ne traite pas

- Le contenu des todolists n'est jamais conservé : il vit uniquement dans le message Discord. PICKET le lit à la création
  de la liste et au clic sur un item, pour écrire le message mis à jour, puis l'oublie aussitôt.
- Le contenu des messages. PICKET ne demande pas l'intent de contenu des messages et ne lit aucun message sur lequel on ne
  lui a pas demandé d'agir.
- Les messages privés : les commandes ne fonctionnent que dans un serveur, et PICKET n'envoie jamais de message privé.
- Les avatars, adresses e-mail et annuaire complet des membres. Les pseudos des participants suivis et utilisateurs du dashboard sont traités comme décrit ci-dessus. Les IP de connexion servent temporairement à limiter les requêtes ; elles ne sont pas stockées dans les statistiques.
- Aucune donnée de personnes de moins de 13 ans : PICKET ne leur est pas destiné et Discord ne les autorise pas.

## Finalités et base légale

Les données servent uniquement à fournir les fonctionnalités demandées, à sécuriser le service et à appliquer les règles de
suppression ci-dessous. Elles sont traitées sur la base de l'intérêt légitime des administrateurs de serveur qui ont choisi
d'ajouter le bot et de l'opérateur à l'exploiter en sécurité (RGPD, article 6, paragraphe 1, point f).

PICKET ne vend, ne loue ni ne concède de licence sur les données, n'affiche aucune publicité, ne prend pas de décision automatisée sur les
membres, n'utilise pas les données pour entraîner des modèles d'apprentissage automatique et ne contacte pas les
utilisateurs en dehors de Discord.

## Destinataires

| Destinataire | Rôle |
| --- | --- |
| Discord Inc. | Plateforme sur laquelle PICKET fonctionne ; elle détient déjà les données qu'elle envoie à PICKET |
| Hébergeur du serveur | Héberge la base de données et l'application dans l'Union européenne |
| Cloudflare, Inc. | Résolution du nom de domaine et filtrage du trafic devant le point d'entrée qui reçoit les requêtes de Discord |
| GitHub, Inc. | Héberge le code source, l'image de conteneur et ce site ; il ne reçoit aucune des données ci-dessus |

Aucun autre tiers ne reçoit les données. Les transferts hors de l'Espace économique européen (Discord, Cloudflare, GitHub)
reposent sur les garanties que ces prestataires publient, comme les clauses contractuelles types de la Commission
européenne.

## Conservation et suppression

- **Le bot est retiré d'un serveur** : les données sont conservées pendant la période de rétention (30 jours), pour que le
  retour du bot restaure tout, puis elles sont effacées.
- **Un administrateur confirme le retrait dans `/picket settings` → Données** : PICKET quitte le serveur et la suppression des données est programmée à la date annoncée.
  Pour l’annuler avant cette date, réinvitez PICKET et annulez la suppression dans ce panneau en tant qu’administrateur du serveur.
- L'effacement supprime tout ce qui est lié au serveur, journal d'audit compris. Il est irréversible. Les sauvegardes
  réalisées avant l'effacement disparaissent sous 30 jours.

La collecte vocale est désactivée par défaut et limitée aux rôles membres explicitement sélectionnés. Les administrateurs du serveur doivent informer leurs membres avant activation. `/stats privacy` et le dashboard permettent de refuser la collecte future ou d’effacer l’historique vocal, sa contribution dérivée et les événements disque en attente. Le dashboard permet l’effacement de vos données dans toute l’instance après votre départ d’un serveur. La vue générale est agrégée ; vos données individuelles sont accessibles à vous et aux officiers/administrateurs du serveur. Les membres ayant accepté l’invitation de la Team propriétaire du bot disposent de l’accès d’instance.

La vue globale PICKET partage avec les utilisateurs connectés uniquement les nombres agrégés de serveurs actifs et de fonctionnalités activées. Elle ne révèle aucun nom, identifiant ou réglage individuel de serveur et ne conserve aucun historique supplémentaire.

Les rapports excluent tout historique au-delà des 60 jours glissants. Le nettoyage physique est périodique et peut être retardé par une panne ; les opérateurs doivent surveiller et rétablir les jobs de purge. La même fenêtre s’applique aux événements en attente sur disque. Les instantanés admin sont actualisés périodiquement. Une demande d’effacement invalide immédiatement les résultats concernés : ils restent inaccessibles pendant leur reconstruction. Leur nettoyage physique suit le rafraîchissement, y compris après la purge quotidienne. L’historique statistique, les instantanés et les sessions du dashboard sont exclus des sauvegardes standard ; les restaurer ne rétablit pas les activités effacées. Les exports téléchargés sont contrôlés par leur destinataire, soumis à ses obligations de rétention.

## Vos droits

Les diagnostics opérationnels sont accessibles uniquement à l'opérateur du
service et ne contiennent ni identifiants Discord ni contenu utilisateur. Ils
sont séparés des journaux de guilde, statistiques vocales, sauvegardes de base et
exports de données applicatives. Ils ne sont jamais inclus dans les exports de
serveur ou personnels. Ils servent à la maintenance du service et expirent après
30 jours ; le nettoyage physique est périodique.

Le RGPD vous permet de demander l'accès aux données vous concernant, leur rectification ou leur effacement, de vous opposer
à leur traitement, d'en demander la limitation ou la portabilité. Votre
identifiant d'utilisateur Discord apparaît dans le journal d'audit et dans les journaux de l'application des serveurs où vous êtes
actif ; l’historique vocal éligible et l’identité du dashboard sont également traités comme indiqué ci-dessus. Pour exercer un droit, contactez le responsable (voir plus haut) : il peut vous être demandé de prouver que
l'identifiant est le vôtre. Une demande d'effacement est traitée en anonymisant votre identifiant dans les entrées
restantes. En cas de désaccord, vous pouvez saisir la CNIL ([cnil.fr](https://www.cnil.fr)).

## Sécurité

Les requêtes de Discord ne sont acceptées que si leur signature est valide. Les secrets sont tenus hors du code, des
journaux et des images. Les données de chaque serveur sont isolées au niveau de la base : une requête faite pour un
serveur ne peut pas lire les lignes d'un autre. En cas de violation touchant des données personnelles, le responsable
notifie l'autorité compétente et Discord comme l'exigent la loi et les Conditions développeur de Discord, et informe les
administrateurs des serveurs concernés.

## Modifications

La date en tête de page change à chaque mise à jour. L'historique est public dans le
[dépôt](https://github.com/NapoSky/picket/commits/main/docs/legal/privacy.md).

Pour les vocaux éphémères, l’export serveur inclut uniquement les noms des modèles actuels. Options, préparations privées, présence opérationnelle, identifiants des canaux et état de vérification/nettoyage sont exclus. Voir [Vocaux éphémères](../guide/voice).
