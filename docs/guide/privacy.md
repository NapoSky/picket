# Privacy and data

::: warning
This page describes what PICKET does; it is not legal advice. If you operate your own instance, you are the data
controller for it: adapt this page to your situation and publish your contact details.
:::

## What PICKET stores

| Data | Why | Kept |
| --- | --- | --- |
| Server identifier and settings (language, time zone, enabled features) | Make the bot work | While the bot is on the server, then the retention period |
| Identifiers of the roles you attach to the officer and member levels | Check access | Same |
| Audit log: who changed what, when, before and after (user identifier) | Accountability | Same |
| Identifier of each processed interaction and its server | Avoid handling the same command twice | 7 days |
| Todo list content | Nothing: it lives only in the Discord message | Not stored by PICKET |
| Application logs: server, user and message identifiers of each todo list click and creation, never the list content | Operate and debug the instance | As long as the operator keeps the logs |

## What PICKET does not store

- The content of messages. PICKET does not request the message content intent.
- Direct messages. Commands only work inside servers.
- Names, avatars or any profile data of members.

## Retention and deletion

- **The bot is removed from a server**: the data is kept during the retention period (30 days by default), so that
  re-adding the bot restores everything, then it is erased.
- **An administrator runs `/picket data delete`**: the server is suspended and its data is erased on the announced date,
  unless `/picket data cancel-deletion` is run before.
- Erasure removes everything linked to the server, including its audit log. It cannot be undone.

## Where the data lives

On the database of the operator of the instance. Servers are isolated from each other at the database level: a query
made on behalf of one server cannot read another server's rows.
