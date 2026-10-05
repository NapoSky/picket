# Getting started

## Add PICKET to your server

Invite the bot with the `bot` and `applications.commands` scopes. Commands reply directly to the person who used them,
so they need no channel permission. **Todo lists and timer boards post public messages**: in the channels where you use
them, the bot needs **View Channel**, **Send Messages** (or **Send Messages in Threads**) and **Embed Links**. PICKET tells
you which one is missing before it opens the form. Other features that post messages (war log) will say what they need
before you enable them.

PICKET only requests the non-privileged `Guilds` gateway intent. It never reads message content and does not need the
members intent.

## First steps

1. Run `/picket status` to check that the bot answers and see how the server is configured.
2. Run `/picket permissions show` to see who may use PICKET. A new server starts with **everyone** allowed to use
   member commands and **nobody** holding the officer level.
3. Choose your officers: `/picket permissions set level:Officer role:@YourOfficers action:Add`.
4. Optionally restrict member commands to your regiment: add your member role, then remove `@everyone`
   (see [Permissions](./permissions)).
5. Set the time zone of your server: `/picket settings timezone timezone:Europe/Paris`.

::: tip Who can change permissions?
Only server administrators: the server owner, and anyone holding a role with the Discord **Administrator** permission.
:::

## Languages

PICKET answers in the language chosen for the server with `/picket settings language`. By default (`Automatic`), it
answers in the language of the person who runs the command (English and French are provided), then in the language of
the Discord community, then in English. Command names are always English; their descriptions follow your Discord
language. See [Translating](../contributing/translating) to add yours.
