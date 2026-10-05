# Commands

Commands start with `/picket`, `/todolist` or `/timers`, work only inside a server, and reply privately (only you see the answer).

| Command | Level | What it does |
| --- | --- | --- |
| `/picket status` | member | Shows that PICKET is running, the server language and time zone, and the enabled features. |
| `/picket permissions show` | member | Shows who holds the officer and member levels, your own level, and warnings about the configuration. |
| `/picket permissions set` | administrator | Adds or removes a role from a level. |
| `/todolist create` | member | Opens a form and posts a todo list in the channel. See [Todo lists](./todolists). |
| `/timers create` | officer | Creates the timer board of the channel. See [Timers](./timers). |
| `/timers add` | member | Adds a timer to the board: type and place (suggestions as you type), then a form. |
| `/timers strike` | member | Strikes a timer off the board. |
| `/timers cleanup` | officer | Removes the struck timers from the board. |
| `/timers repair` | officer | Reposts the board messages from the saved timers. |
| `/timers settings` | officer | Shows or changes the settings of the board: alerts, limits, purge. |
| `/picket settings language` | officer | Sets the language of the server, or back to automatic. |
| `/picket settings timezone` | officer | Sets the time zone of the server. |
| `/picket settings audit-channel` | officer | Sets (or clears) the audit channel. |
| `/picket settings feature` | officer | Enables or disables a feature. |
| `/picket data delete` | administrator | Schedules the permanent deletion of the server data. |
| `/picket data cancel-deletion` | administrator | Cancels a scheduled deletion. |

## `/picket permissions set`

| Option | Meaning |
| --- | --- |
| `level` | `Officer` or `Member`. |
| `role` | The role to change. `@everyone` is accepted for `Member` only. |
| `action` | `Add` or `Remove`. |
| `confirm` | Required to give `@everyone` the member level, because it opens PICKET to the whole server. |

Repeating a change does nothing and is not logged. Every effective change is recorded in the audit log with the
author, the time, and the state before and after.

## `/picket settings`

- **`language`**: pick a language, or `Automatic`. With a language chosen, **everyone** gets PICKET's answers in it,
  whatever their own Discord language. `Automatic` follows each user's Discord language, then English.
- **`timezone`**: an IANA name such as `Europe/Paris`, `America/New_York` or `UTC`. It only affects how times are
  displayed and grouped; times are stored in UTC.
- **`audit-channel`**: the channel meant to receive the audit log. Leave the option empty to remove it. PICKET does not
  post there yet: changes are recorded in the audit log in the database in the meantime.
- **`feature`**: `Timers`, `Todo lists` or `War log`, and `enabled` true or false. Timers and todo lists are available;
  the `War log` switch is stored now so that your choice is already in place when it is released.

Every effective change is recorded in the audit log, like permission changes. `/picket status` shows the current values.

## `/picket data delete`

Run it without `confirm` to see exactly what will happen and when. With `confirm:True`, the server is **suspended**:
PICKET refuses every command except `/picket data cancel-deletion` until the deletion date, then erases the data. See
[Privacy Policy](../legal/privacy).

## Coming next

The Foxhole war log. It will appear here as it is released.
