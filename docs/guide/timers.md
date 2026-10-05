# Timers

A timer board is a message in a channel that lists the resources your regiment has to keep an eye on (stockpiles,
facilities, fields, ships, tanks, trains), each with its countdown and a button to reset it. PICKET warns you before a
countdown ends.

## Set up a board

An officer runs `/timers board create` in the channel that should hold the board. The bot needs **View Channel**,
**Send Messages** (or **Send Messages in Threads**) and **Embed Links** there; PICKET tells you which one is missing.
A channel has one board, and a server can have up to 10.

## Add a timer

Anyone with the member level runs `/timers add`:

| Option | Meaning |
| --- | --- |
| `type` | What the timer tracks (see the table below). |
| `region` | The region (hex). Start typing and pick one of the suggestions. |
| `location` | The town or location in that region, with suggestions too. |
| `owner` | Who looks after it. You, if you leave it empty. |

A form then asks for the **name** (15 characters at most), the **code** when the type has one, and the **duration** when
the timer counts down.

| Type | Counts | Code | Default duration |
| --- | --- | --- | --- |
| Stockpile | down | 6 digits, required | 50 h |
| Facility | down | none | 50 h |
| Field | up (time since the last refresh) | none | not asked |
| Naval ship | down | 3 to 6 letters or digits, optional | 48 h |
| Tank | down | 3 to 6 letters or digits, optional | 48 h |
| Train | down | 3 to 6 letters or digits, optional | 48 h |

The durations of 50 h and 48 h are the ones the bot started with; you can type any duration between 1 minute and 30
days. Write hours (`50`, `1.5`) or units (`90m`, `2h30m`, `1d 12h`).

PICKET never corrects a place on its own: pick a suggestion, or the command is refused.

## Read the board

Each line shows a letter, the type, the name and code, the moment the countdown ends (or the time since the last
refresh), and the owner:

```text
🇦・📦 **North depot** `123456`・in 2 days・@Jules
```

- The letter is the one on the button below the board. Letters restart on each message: a board holds **25 active
  timers per message**, and PICKET adds a message when it needs one.
- ⌛ marks a timer whose countdown is over. It stays on the board until someone strikes it (or the board purges it).
- A struck timer is crossed out, has no button, and keeps its original duration.

## Refresh a timer

Click its letter button. The countdown restarts from its duration (or from zero for a field). Many clicks at once are
all taken into account, and the board is updated once, not once per click.

## Strike and clean up

- `/timers strike` suggests the active timers of the channel. A struck timer stays visible, crossed out.
- Adding the same timer again (same type, name, place and code) brings the struck one back instead of creating a
  duplicate.
- `/timers cleanup` removes the struck timers. The board always keeps at least one message.

## Alerts

By default, PICKET posts a **silent** alert in the channel 2 hours before a countdown ends, with a ✅ button that
removes it. The alert goes away on its own when the timer is refreshed, struck or expired, and comes back for the next
deadline after a refresh.

If PICKET was interrupted, it sends one alert for the closest threshold reached, never a burst of old ones.

To notify a role, add it with `/timers settings alert-role`. A role can be notified when it is mentionable, or when
PICKET has the Discord permission **Mention @everyone, @here and All Roles**.

## Settings

`/timers settings` without option shows the settings. With options, it changes them.

| Option | Meaning | Default |
| --- | --- | --- |
| `alerts` | Send alerts. | on |
| `thresholds` | When to alert before the end, for example `6h, 2h, 30m` (4 at most, from 5 minutes to 7 days). | `2h` |
| `alert-role`, `alert-role-action` | Roles to notify (5 at most): add, remove, or clear all. | none |
| `silent` | Alerts without push notification. | on |
| `duplicates` | Identical active timer: add it with a warning, or refuse it. | warn |
| `restrict-changes` | Only the owner of a timer and officers can strike or refresh it. | off |
| `max-active` | Active timers on the board (1 to 100). | 50 |
| `purge-after` | Delete struck or expired timers after this many hours (0 = never). | 0 |
| `reset-on-new-war` | Empty the board when a new war starts. Takes effect once the war log is released. | off |

## Who can do what

| Level | Can |
| --- | --- |
| member | Add, strike and refresh timers, acknowledge alerts. |
| officer | Create a board, clean it up, repair it, change its settings. |

With `restrict-changes`, a member can only strike or refresh their own timers.

## When something goes wrong

- A moderator deleted a board message: the next change reposts it, or run `/timers repair`.
- PICKET lacks a permission or Discord is slow: your change is saved, the answer tells you the board will be updated
  later, and PICKET retries on its own.
- The channel was deleted: the board is disabled and its history kept. Create a new one with `/timers board create`.

## What PICKET stores

Unlike todo lists, the timers live in PICKET's database, because countdowns and alerts must survive a deleted message
or a restart. It stores the board settings, each timer (type, name, code, place, owner, start, duration) and a history
of who did what. Names and codes are visible to everyone who can read the channel: do not type personal data in
them. See the [Privacy Policy](../legal/privacy).
