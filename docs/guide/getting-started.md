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

## Languages

PICKET supports **English, French, German, Spanish and Brazilian Portuguese**. Keep **Automatic** to follow each
person's Discord language, or choose a language for everyone in `/picket settings` → **Language**.

Command names are always English; their descriptions follow your Discord language.
See [Translating](../contributing/translating) to add a language or improve an existing translation.
