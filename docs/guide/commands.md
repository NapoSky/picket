# Commands

Commands start with `/picket`, `/todolist` or `/timers`, work inside a server and reply privately. Created lists and boards are public messages.

| Command | Level | What it does |
| --- | --- | --- |
| `/picket status` | member | Shows settings, available modules, configured access roles and your access level. |
| `/picket settings` | officer | Opens the private settings panel with no arguments. Only administrators can edit permissions and manage data. |
| `/todolist create` | member | Opens a form and posts a todo list in the channel. See [Todo lists](./todolists). |
| `/timers create` | officer | Creates the timer board of the channel. See [Timers](./timers). |
| `/timers add` | member | Adds a timer to the board: type and place (suggestions as you type), then a form. |
| `/timers strike` | member | Strikes a timer off the board. |
| `/timers cleanup` | officer | Removes the struck timers from the board. |
| `/timers repair` | officer | Reposts the board messages from the saved timers. |
| `/timers settings` | officer | Opens this channel’s private board panel with no arguments: alerts, roles, access and cleanup. |

## The `/picket settings` panel

Only the person who opens the panel can see it. Changes apply immediately and update the same message. Controls expire after fifteen minutes of inactivity; run the command again to continue.

Each section has its own color and icon; the current section’s button is highlighted. Module states display **🟢 Enabled** or **⚪ Disabled**. Confirmations highlight which data is retained or deleted.

- **Overview**: language and activation of Timers and Todo lists. Disabling a module requires confirmation: its interactions and background processing stop, while existing data is retained.
- **Language**: a fixed language applies to everyone. English, French, German, Spanish and Brazilian Portuguese are available. Automatic follows each user’s Discord language, then the Discord server language, then English. Languages are paginated when necessary.
- **Permissions**: officers can view roles; administrators add or remove one role at a time. Opening member access to `@everyone` requires confirmation. `@everyone` can never be an officer. Add a member role before removing `@everyone` if members should retain access.
- **Advanced**: the IANA time zone remains preconfiguration and does not change timer displays; Discord displays timestamps in each viewer’s time zone. The audit channel publishes configuration changes, todolist creations, timer creations and removals, and alert acknowledgements. Countdown restarts and todolist contents are excluded. PICKET requires View Channel, Send Messages and Embed Links in the selected channel. If access is lost, publication pauses; restore the permissions and use **Test / resume audit**. War log is marked “Coming soon” and cannot be enabled.
- **Data**: only administrators see this screen. It explains deletion, its date and consequences before confirmation.

Every effective settings or permission change is audited in the database with its author and before/after state. Repeating a change adds no audit record.

## Deletion and recovery

In **Data**, preview and confirm deletion. PICKET immediately suspends its features. After the operator-configured retention period (30 days by default), configuration, access roles, timers, history and audit records are permanently erased. Discord messages, including todolists, are not automatically deleted.

During suspension, `/picket settings` remains available: it displays the date and lets an administrator cancel deletion. Other settings are unavailable. Running this command again allows recovery even after a panel expires. See [Privacy](../legal/privacy).

The old settings, permissions and data subcommands are replaced by this panel. During transition, an old command opens the corresponding screen **without applying its arguments**.
