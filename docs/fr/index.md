---
layout: home
hero:
  name: PICKET
  text: Le poste de veille opérationnel d'un régiment
  tagline: Savoir ce qui doit être fait, ce qui doit être surveillé et ce qui s'est passé pendant votre absence.
  actions:
    - theme: brand
      text: Commencer
      link: /fr/guide/getting-started
    - theme: alt
      text: L'héberger soi-même
      link: /fr/self-hosting/install
    - theme: alt
      text: Discord de support
      link: https://discord.gg/EUnVfq5EYs
features:
  - title: Neutre entre les factions
    details: Pensé pour les Wardens comme pour les Colonials, avec une identité visuelle qui ne favorise aucun camp.
  - title: Multi-serveur par conception
    details: Chaque serveur est isolé au niveau de la base de données. Rien de ce qu'un régiment configure n'est visible d'un autre.
  - title: Sûr à exploiter
    details: Mises à jour sans interruption, requêtes signées uniquement, secrets hors du dépôt et hors des journaux.
landing:
  modules:
    title: Ce que PICKET fait pour votre régiment
    subtitle: Un bot Discord qui centralise la coordination du quotidien, sans lire vos messages.
    items:
      - name: Timers
        text: Des tableaux de comptes à rebours pour stockpiles, installations, champs, navires et trains, avec une alerte avant l'échéance.
        link: /fr/guide/timers
      - name: Todolists
        text: Un bouton par tâche. Chacun coche ce qu'il a fait, et le message se supprime tout seul quand tout est terminé.
        link: /fr/guide/todolists
      - name: Permissions
        text: Niveaux membre et officier par serveur, gérés avec les rôles que vous avez déjà.
        link: /fr/guide/permissions
      - name: War-log
        text: Un historique de ce qui s'est passé pendant votre absence.
        soon: Prochainement
  steps:
    title: Opérationnel en trois étapes
    items:
      - title: Invitez le bot
        text: Ajoutez PICKET avec les scopes bot et applications.commands. Il ne demande que l'intent Guilds, non privilégié.
      - title: Choisissez vos officiers
        text: Ouvrez /picket settings pour choisir la langue, les modules et les rôles autorisés.
      - title: Publiez votre premier tableau
        text: Utilisez /timers create ou /todolist create dans le salon de votre choix, le régiment fait le reste.
  neutral:
    title: Neutre entre Wardens et Colonials
    text: PICKET est fait pour toute la communauté. Son identité emprunte un bleu et un vert atténués sur une base acier, et réserve l'ambre aux signaux qui demandent de l'attention.
    swatches:
      - label: Bleu d'inspiration Warden
        color: '#6f9cc9'
      - label: Vert d'inspiration Colonial
        color: '#8aa07a'
      - label: Acier et charbon
        color: '#323639'
      - label: Ambre, réservé aux alertes
        color: '#fcb539'
  cta:
    title: Pour aller plus loin
    text: Apprenez à utiliser PICKET, hébergez votre propre instance ou consultez les conditions qui s'appliquent.
    cards:
      - title: Guide d'utilisation
        text: Commandes, timers, todolists et permissions.
        link: /fr/guide/getting-started
      - title: Auto-hébergement
        text: Installer et configurer votre propre instance.
        link: /fr/self-hosting/install
      - title: Mentions légales
        text: Conditions d'utilisation et politique de confidentialité.
        link: /fr/legal/terms
---
