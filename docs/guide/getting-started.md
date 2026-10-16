# Getting started

## Add PICKET to your server

**[Add PICKET to Discord](https://discord.com/oauth2/authorize?client_id=1556492432521302146)**, choose your server and
confirm the invitation. Discord requests the permissions PICKET needs automatically.

## First steps

1. As a server administrator, open `/picket settings` to choose your language and modules.
2. In **Permissions**, choose who can configure PICKET and who can use it. To restrict access to your regiment, add its
   member role, then remove `@everyone` access.
3. Create a [todo list](./todolists) with `/todolist create`, or a [timer board](./timers) with `/timers create`, then add
   a timer with `/timers add`.

Initially, everyone has member access and only administrators can configure PICKET or create boards. Add an officer
role to delegate configuration. Permission changes and data management remain reserved for administrators.
Use `/picket status` to check the bot and your access level. See [Permissions](./permissions) for details.


## Request temporary voice channels

An officer prepares templates in `/picket settings` → **Temporary voice channels** → **Configure**.
Members then run `/picket voice`, choose templates and quantities, and deploy their queue together.
Empty channels clean themselves up after the configured delay. See [Temporary voice channels](./voice) for a
first deployment, settings and permissions.

## Open the statistics dashboard

Visit **[stats.picket-foxhole.com](https://stats.picket-foxhole.com)** and sign in with Discord, or run `/stats link`.
Collection is disabled by default: an administrator must select actual member roles before it can be enabled.
See [Voice statistics](./stats) for your first setup, access levels and privacy controls.

## Languages

PICKET supports **English, French, German, Spanish, Brazilian Portuguese and Polish**. Keep **Automatic** to follow each
person's Discord language, or choose a language for everyone in `/picket settings` → **Language**.

Command names are always English; their descriptions follow your Discord language.
See [Translating](../contributing/translating) to add a language or improve an existing translation.

Need help or want to share feedback? Join the [PICKET support Discord](https://discord.gg/syCQmrPxsV).
