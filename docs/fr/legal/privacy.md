# Politique de confidentialité

Date d'effet : 5 octobre 2026.

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
| Sauvegardes de la base contenant les données ci-dessus | Se rétablir après une panne | 30 jours au plus |

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
- Les pseudos, avatars, adresses e-mail, adresses IP des membres, ni aucune autre donnée de profil.
- Aucune donnée de personnes de moins de 13 ans : PICKET ne leur est pas destiné et Discord ne les autorise pas.

## Finalités et base légale

Les données servent uniquement à fournir les fonctionnalités demandées, à sécuriser le service et à appliquer les règles de
suppression ci-dessous. Elles sont traitées sur la base de l'intérêt légitime des administrateurs de serveur qui ont choisi
d'ajouter le bot et de l'opérateur à l'exploiter en sécurité (RGPD, article 6, paragraphe 1, point f).

PICKET ne vend, ne loue ni ne concède de licence sur les données, n'affiche aucune publicité, ne profile pas les
utilisateurs, n'utilise pas les données pour entraîner des modèles d'apprentissage automatique et ne contacte pas les
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
- **Un administrateur confirme la suppression dans `/picket settings` → Données** : le serveur est suspendu et ses données sont effacées à la date
  annoncée, sauf si un administrateur l’annule dans ce panneau avant cette date.
- L'effacement supprime tout ce qui est lié au serveur, journal d'audit compris. Il est irréversible. Les sauvegardes
  réalisées avant l'effacement disparaissent sous 30 jours.

## Vos droits

Le RGPD vous permet de demander l'accès aux données vous concernant, leur rectification ou leur effacement, de vous opposer
à leur traitement, d'en demander la limitation ou la portabilité. En pratique, la seule donnée vous concernant est votre
identifiant d'utilisateur Discord dans le journal d'audit et dans les journaux de l'application des serveurs où vous êtes
actif. Pour exercer un droit, contactez le responsable (voir plus haut) : il peut vous être demandé de prouver que
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
