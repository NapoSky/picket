# Privacy Policy

Effective date: 5 October 2026.

This policy describes the data processed by the official PICKET instance (the Discord application "PICKET" and the site
`docs.picket-foxhole.com`). It applies together with the [Terms of Service](./terms) and Discord's own
[Privacy Policy](https://discord.com/privacy).

::: warning Self-hosted instances
Anyone can run their own copy of PICKET. This policy only covers the official instance. The operator of another
instance is the data controller for it and must publish their own policy.
:::

## Who is responsible

The controller is NapoSky, an individual based in France, who operates the official instance as a non-commercial
community project.

To ask a question, exercise a right or report a problem, open an issue on
[github.com/NapoSky/picket/issues](https://github.com/NapoSky/picket/issues). Issues are public: do not put personal
data in one. For anything sensitive, use a
[private security report](https://github.com/NapoSky/picket/security/advisories/new).

## What PICKET processes

| Data | Why | Kept |
| --- | --- | --- |
| Server identifier and settings (language, time zone, enabled features) | Make the bot work | While the bot is on the server, then the retention period |
| Identifiers of the roles attached to the officer and member levels | Check access | Same |
| Audit log: who changed what, when, before and after (Discord user identifier) | Accountability | Same |
| Timer boards: channel, settings (alert thresholds, identifiers of the notified roles, limits) and identifiers of the messages PICKET published | Show and update the board | Same |
| Timers: type, name, code, place, owner (Discord user identifier), start and duration, as typed by members | Show the countdowns and send alerts | Same, or until the timer is cleaned up or purged |
| Timer history: who added, refreshed, struck or cleaned up which timer, and when (Discord user identifier) | Accountability | Same |
| Alerts sent for each timer | Never send the same alert twice | Same |
| Identifier of each processed interaction and its server | Avoid handling the same command twice | 7 days |
| Application logs: server, user, channel and message identifiers of each todo list or timer creation and click, never the list content nor the timer names | Operate, secure and debug the service | 30 days |
| Database backups of the data above | Recover from a failure | 30 days at most |

Discord sends PICKET the identifiers of the server, channel, user and roles involved in each command or button click.
They are used to answer that interaction and to check permissions. Only the data listed above is kept.

The names and codes typed in a timer are shown to everyone who can read the channel and are stored as typed: members are
asked not to put personal data in them.

### What PICKET does not process

- Todo list content is never stored: it lives only in the Discord message. PICKET reads it when you create the list and
  when you click an item, to write the updated message, and forgets it immediately.
- Message content. PICKET does not request the message content intent and reads no message it was not asked to act on.
- Direct messages: commands only work inside servers, and PICKET never sends direct messages.
- Names, avatars, e-mail addresses, IP addresses of members, or any other profile data.
- No data from persons under the age of 13: PICKET is not directed at them and Discord does not allow them.

## Why, and on what basis

The data is used only to provide the features you asked for, to secure the service and to meet the deletion rules
below. It is processed on the basis of the legitimate interest of server administrators who chose to add the bot and of
the operator in running it safely (GDPR, article 6(1)(f)).

PICKET does not sell, rent or license data, does not show advertising, does not profile users, does not use data to train
machine learning models, and does not contact users outside Discord.

## Who receives the data

| Recipient | Role |
| --- | --- |
| Discord Inc. | Platform on which PICKET runs; it already holds the data it sends to PICKET |
| Hosting provider of the server | Hosts the database and the application in the European Union |
| Cloudflare, Inc. | Domain name resolution and traffic filtering in front of the endpoint that receives Discord's requests |
| GitHub, Inc. | Hosts the source code, the container image and this site; it receives none of the data above |

No other third party receives the data. Transfers outside the European Economic Area (Discord, Cloudflare, GitHub) rely
on the safeguards those providers publish, such as the European Commission's standard contractual clauses.

## Retention and deletion

- **The bot is removed from a server**: the data is kept during the retention period (30 days), so that re-adding the
  bot restores everything, then it is erased.
- **An administrator confirms deletion in `/picket settings` → Data**: the server is suspended and its data is erased on the announced date,
  unless an administrator cancels it in the same panel before that date.
- Erasure removes everything linked to the server, including its audit log. It cannot be undone. Backups made before the
  erasure disappear within 30 days.

## Your rights

Under the GDPR you may ask for access to, correction or erasure of the data about you, object to its processing, or ask
for it to be restricted or exported. In practice the only data about you is your Discord user identifier in the audit log
and in the application logs of your servers. Contact the controller (see above) to exercise a right: you may be asked to
prove that the identifier is yours. An erasure request is handled by anonymising your identifier in the entries that
remain. If you are not satisfied, you may complain to the CNIL, the French data protection authority
([cnil.fr](https://www.cnil.fr)).

## Security

Requests from Discord are accepted only if their signature is valid. Secrets are kept out of the code, the logs and the
images. Each server's data is isolated at the database level: a query made for one server cannot read another server's
rows. If a breach affecting personal data occurs, the controller notifies the competent authority and Discord as the law
and Discord's Developer Terms require, and informs the affected server administrators.

## Changes

The date at the top of this page changes with every update. The history is public in the
[repository](https://github.com/NapoSky/picket/commits/main/docs/legal/privacy.md).
