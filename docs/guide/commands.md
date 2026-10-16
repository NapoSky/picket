# Commands

Commands start with `/picket`, `/todolist`, `/timers`, `/warlog` or `/stats`, work inside a server and reply privately. Created lists and boards are public messages.

| Command | Level | What it does |
| --- | --- | --- |
| `/picket status` | member | Shows settings, available modules, configured access roles and your access level. |
| `/picket voice` | member | Build a private queue of templates and quantities, then deploy temporary voice channels. See [Temporary voice channels](./voice). |
| `/picket settings` | officer | Opens the private settings panel with no arguments. Only administrators can edit permissions and manage data. |
| `/todolist create` | member | Opens a form and posts a todo list in the channel. See [Todo lists](./todolists). |
| `/timers create` | officer | Creates the timer board of the channel. See [Timers](./timers). |
| `/timers add` | member | Adds a timer to the board: type and place (suggestions as you type), then a form. |
| `/timers strike` | member | Strikes a timer off the board. |
| `/timers cleanup` | officer | Removes the struck timers from the board. |
| `/timers repair` | officer | Reposts the board messages from the saved timers. |
| `/timers settings` | officer | Opens this channel’s private board panel with no arguments: alerts, roles, access and cleanup. |
| `/warlog settings` | officer | Chooses a regular text channel, one to three zones and activation for the current war. See [War log](./warlog). |
| `/stats settings` | officer | Configure explicit activation and excluded channels; member role changes require an administrator. |
| `/stats status` | officer | Show collection settings and retention. |
| `/stats export` | officer | Export statistics exclusively for this server (CSV/JSON, 1–60 days). |
| `/stats link` | member | Open [the official dashboard](https://stats.picket-foxhole.com). |
| `/stats privacy` | member | Opt out or erase your voice history. |

See [Voice statistics](./stats) for scope, privacy and metric definitions.

## The `/picket settings` panel

Only the person who opens the panel can see it. Changes apply immediately and update the same message. Controls expire after fifteen minutes of inactivity; run the command again to continue.

Each section has its own color and icon; the current section’s button is highlighted. Module states display **🟢 Enabled** or **⚪ Disabled**. Confirmations highlight which data is retained or deleted.

- **Overview**: language and activation of Timers, Todo lists, War log and Stats. Enabling the war log opens its channel and zone settings for confirmation. **Configure** reopens an enabled War log or Stats module without changing its activation. These panels include **PICKET settings** to return to the overview; this button appears only when opened from `/picket settings`, and returning keeps any saved changes. Disabling a module requires confirmation: its interactions and background processing stop, while existing data is retained. Disabling the war log also cancels pending messages.
- **Language**: a fixed language applies to everyone. English, French, German, Spanish, Brazilian Portuguese and Polish are available. Automatic follows each user’s Discord language, then the Discord server language, then English. Languages are paginated when necessary.
- **Permissions**: officers can view roles; administrators add or remove one role at a time. Opening member access to `@everyone` requires confirmation. `@everyone` can never be an officer. Add a member role before removing `@everyone` if members should retain access.
- **Advanced**: the IANA time zone remains preconfiguration and does not change timer displays; Discord displays timestamps in each viewer’s time zone. The audit channel publishes configuration changes, todolist creations, timer creations and removals, and alert acknowledgements. Countdown restarts and todolist contents are excluded. PICKET requires View Channel, Send Messages and Embed Links in the selected channel. If access is lost, publication pauses; restore the permissions and use **Test / resume audit**. Configure the war log using `/warlog settings`; see [War log](./warlog).
- **Data**: administrators can export server data or request deletion. The export includes Stats settings, tracking preferences and 60-day member summaries, with pending voice counts; individual voice segments and raw events are omitted. See [Voice statistics](./stats#managing-your-data). The screen explains deletion, its date and consequences before confirmation.

Every effective settings or permission change is audited in the database with its author and before/after state. Repeating a change adds no audit record.

## Deletion and recovery

In **Data**, preview and confirm removal. PICKET sends the final private confirmation before leaving the server and immediately schedules data deletion. If that reply cannot be sent, the bot does not leave; retry the confirmation. After the operator-configured retention period (30 days by default), configuration, access roles, timers, history and audit records are permanently erased. Discord messages, including todolists, are not automatically deleted.

To cancel deletion before the deadline, invite PICKET back, then open `/picket settings` → **Data** as a server administrator and cancel the scheduled deletion. Reinvitation alone does not cancel an explicit deletion request. See [Privacy](../legal/privacy).

The old settings, permissions and data subcommands are replaced by this panel. During transition, an old command opens the corresponding screen **without applying its arguments**.

Temporary voice channels are enabled by default and configurable from the settings home. Disabling this module blocks new deployments while existing channel cleanup continues. See [Temporary voice channels](./voice).
