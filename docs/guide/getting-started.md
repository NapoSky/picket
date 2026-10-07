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

1. Run `/picket status` to check the bot and see access permissions. Initially everyone has member access; only administrators can configure PICKET.
2. As an administrator, open `/picket settings`, then **Permissions → Who can configure PICKET?**, and select your officer role.
3. To restrict the bot to your regiment, add your role under **Who can use PICKET?**, then remove `@everyone` access.
4. Choose the language and modules from the panel overview. The time zone is advanced preconfiguration and is not required to use the bot.

::: tip Who can change permissions?
Only server administrators: the server owner, and anyone holding a role with the Discord **Administrator** permission.
:::

## Languages

PICKET supports **English, French, German, Spanish and Brazilian Portuguese**. Choose a fixed language for everyone
with `/picket settings` → **Language**, or keep **Automatic**: PICKET uses the person’s Discord language, then the
Discord server’s language, then English. Spanish variants use the Spanish catalog; Portuguese variants use the
Brazilian Portuguese catalog when no exact translation is available.

Command names are always English; their descriptions follow your Discord language.
See [Translating](../contributing/translating) to add a language or improve an existing translation.
