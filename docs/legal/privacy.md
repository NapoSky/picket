# Privacy Policy

Effective date: 14 October 2026.

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
| Separate operational diagnostics: timestamps, service/version, technical events, durations, aggregate failure counts and resource usage; no Discord identifiers or user content | Detect failures and maintain availability | 30 days |
| War-log subscription: channel, selected zones, reference faction, language, activation for a war and configuration audit | Publish requested public game events | While the bot is on the server, then the retention period |
| War-log deliveries and optional timer-reset execution records | Control publication and avoid repeated actions | Same, with completed deliveries cleaned up during collection |
| Eligible voice events and channel presence segments: server/user/channel identifiers and timestamps | Provide opt-in server statistics | Rolling maximum of 60 days |
| Voice participant display names and channel labels | Make reports readable | At most 60 days since their last observed activity |
| Temporary connected human voice state, including roles | Handle eligibility changes and Gateway recovery without a complete member roster | Until disconnection, exclusion or expiry; maximum 60 days |
| Opt-out preferences and erasure cutoffs | Honour objections and prevent delayed replay restoring erased data | Configuration state until guild deletion |
| Dashboard identity and encrypted OAuth access tokens | Authenticate Discord users and verify membership | Session expiry, at most eight hours; OAuth state ten minutes |
| Database backups of the data above | Recover from a failure | 30 days at most |

Public Foxhole game state and recorded events are shared across subscriptions and kept for the current and preceding observed wars. They contain game structures, coordinates, factions and timestamps, without Discord member identifiers. Server deletion does not erase this shared public game history.

Discord sends PICKET the identifiers of the server, channel, user and roles involved in each command or button click.
They are used to answer that interaction and to check permissions. Only the data listed above is kept.

The names and codes typed in a timer are shown to everyone who can read the channel and are stored as typed: members are
asked not to put personal data in them.

### What PICKET does not process

- Todo list content is never stored: it lives only in the Discord message. PICKET reads it when you create the list and
  when you click an item, to write the updated message, and forgets it immediately.
- Message content. PICKET does not request the message content intent and reads no message it was not asked to act on.
- Direct messages: commands only work inside servers, and PICKET never sends direct messages.
- Avatars, e-mail addresses and a full member directory. Display names of tracked voice participants and dashboard users are processed as described above. Connection IP addresses are used transiently for request rate limiting; they are not stored in statistics.
- No data from persons under the age of 13: PICKET is not directed at them and Discord does not allow them.

## Why, and on what basis

The data is used only to provide the features you asked for, to secure the service and to meet the deletion rules
below. It is processed on the basis of the legitimate interest of server administrators who chose to add the bot and of
the operator in running it safely (GDPR, article 6(1)(f)).

PICKET does not sell, rent or license data, does not show advertising, does not make automated decisions about members, does not use data to train
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
- **An administrator confirms removal in `/picket settings` → Data**: PICKET leaves the server and its data is scheduled for erasure on the announced date.
  To cancel before that date, invite PICKET back and cancel deletion in that panel as a server administrator.
- Erasure removes everything linked to the server, including its audit log. It cannot be undone. Backups made before the
  erasure disappear within 30 days.

Voice collection is disabled by default and restricted to explicitly selected member roles. Server administrators should inform members before activation. Use `/stats privacy` or the dashboard to opt out of future collection or erase your voice history, including its derived contribution and pending disk records. The dashboard can erase your own data across the instance after you leave a server. Overview figures are aggregate; individual records are visible to you and officers/administrators of that server. Accepted members of the bot application's owning Team have instance access.

The shared PICKET overview shows authenticated users only aggregate counts of active servers and enabled features. It exposes no server names, identifiers or individual settings and stores no additional history.

Statistical history expires within the rolling 60-day window in all reports. Physical cleanup runs periodically and may be delayed during outages; operators must monitor and restore purge jobs. The same window applies to queued disk events. Admin snapshots update periodically. Erasure invalidates their results immediately: they remain inaccessible while a replacement is built. Physical snapshot cleanup follows refresh completion, including after the daily purge. Statistical history, snapshots and dashboard session data are excluded from standard backups; erasure cannot be undone by restoring those backups. Downloaded exports are controlled by their recipient and must follow their retention duties.

## Your rights

Operational diagnostics are accessible only to the service operator and contain
no Discord identifiers or user content. They are separate from guild journals,
voice statistics, database backups and application data exports. They are never
included in server or personal exports. Their purpose is service maintenance;
they expire after 30 days, with physical cleanup performed periodically.

Under the GDPR you may ask for access to, correction or erasure of the data about you, object to its processing, or ask
for it to be restricted or exported. Your Discord user identifier appears in the audit log
and in application logs; eligible voice history and dashboard identity are also processed as listed above. Contact the controller (see above) to exercise a right: you may be asked to
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
