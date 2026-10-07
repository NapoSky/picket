---
layout: home
hero:
  name: PICKET
  text: The operational watchpost of a regiment
  tagline: Know what must be done, what must be monitored, and what happened while you were away.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Self-host it
      link: /self-hosting/install
    - theme: alt
      text: Support Discord
      link: https://discord.gg/EUnVfq5EYs
features:
  - title: Faction-neutral
    details: Built for Wardens and Colonials alike, with a visual identity that favours neither side.
  - title: Multi-server by design
    details: Every server is isolated at the database level. Nothing a regiment configures is visible to another.
  - title: Safe to operate
    details: Zero-downtime updates, signed requests only, secrets kept out of the repository and out of the logs.
landing:
  modules:
    title: What PICKET does for your regiment
    subtitle: A Discord bot that keeps the day-to-day coordination in one place, without reading your messages.
    items:
      - name: Timers
        text: Boards of countdowns for stockpiles, facilities, fields, ships and trains, with a warning before they expire.
        link: /guide/timers
      - name: Todo lists
        text: One button per item. Everyone ticks tasks off, and the message cleans itself up when all is done.
        link: /guide/todolists
      - name: Permissions
        text: Member and officer levels per server, managed with roles you already have.
        link: /guide/permissions
      - name: War log
        text: A history of what happened while you were away.
        soon: Next
  steps:
    title: Up and running in three steps
    items:
      - title: Invite the bot
        text: Add PICKET with the bot and applications.commands scopes. It only asks for the non-privileged Guilds intent.
      - title: Choose your officers
        text: Open /picket settings to choose your language, modules and access roles.
      - title: Post your first board
        text: Use /timers create or /todolist create in the channel of your choice and let the regiment take it from there.
  neutral:
    title: Neutral between Wardens and Colonials
    text: PICKET is made for the whole community. Its identity borrows a muted blue and a muted green on a steel base, and keeps amber for the signals that need attention.
    swatches:
      - label: Warden-inspired blue
        color: '#6f9cc9'
      - label: Colonial-inspired green
        color: '#8aa07a'
      - label: Steel and charcoal
        color: '#323639'
      - label: Amber, for alerts only
        color: '#fcb539'
  cta:
    title: Where to go next
    text: Learn how to use PICKET, run your own instance, or read the terms that apply.
    cards:
      - title: User guide
        text: Commands, timers, todo lists and permissions.
        link: /guide/getting-started
      - title: Self-hosting
        text: Install and configure your own instance.
        link: /self-hosting/install
      - title: Legal
        text: Terms of Service and Privacy Policy.
        link: /legal/terms
---
