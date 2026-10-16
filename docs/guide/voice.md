# Temporary voice channels

PICKET 1.1 lets members build a private queue of officer-defined templates and deploy one or several voice channels with `/picket voice`. No dedicated request channel is needed. The module is enabled by default; an officer must first create a template.

## Configure templates

Open `/picket settings` → **Temporary voice channels** → **Configure**. Officers can add, edit, duplicate or remove templates, up to **10 per server**. Each template has:

- A template name shown to members.
- A Discord destination category.
- A voice channel name; PICKET appends a number automatically.
- A capacity of **1–99 people**, default **99**. Unlimited capacity is not supported.
- A continuously empty interval of **1, 5, 10, 15, 20 or 30 minutes**, default **15**.

The modal uses native category and delay selectors. A removed or modified template does not change existing channels. Removing a template asks for confirmation.

The deployment limit defaults to **6 channels total**, adjustable by officers from 1 to **10**. The server may have at most **15 open or reserved channels**, including requests in progress or awaiting verification. Concurrent requests share that quota.

## Prepare and deploy

1. Run `/picket voice`. The private queue starts empty.
2. Select a template. Its category, capacity and cleanup interval appear.
3. Choose a quantity, then **Add**. The selection resets for the next entry.
4. Repeat for other templates. Adding the same template increases its quantity.
5. Use the queue selector to edit an entry; a quantity of 0 removes that queue entry. This does not allow voice capacity 0.
6. Choose **Deploy N channels** once the queue is ready.

Search filters the template selector. Only destinations the member can view and join are offered. **Clear queue** resets the selection; **Cancel** abandons preparation. Draft controls expire after 15 minutes of inactivity. Each draft is bound to its server and owner; stale controls cannot replay a deployment.

Deployment is queued durably. **Refresh** shows each channel as queued, creating, open, not created or awaiting verification, with links to created channels. **New deployment** starts another empty queue. A changed template or lost destination access blocks confirmation; rebuild affected entries.

## Cleanup and recovery

An unused new channel starts its timer at creation. Any occupant, including a bot, cancels the timer. The last departure starts a full new interval. The creator leaving does not remove a channel occupied by others.

Officers can inspect **Open channels** and request **Delete if empty**. Disabling the module blocks new deployments and cancels queued creations while existing channels keep their cleanup lifecycle.

Tracking and confirmed deployment requests are stored in PostgreSQL. After a restart, PICKET checks recorded channels and rebuilds reliable occupancy before cleanup. A confirmed missing channel releases its quota slot. Permission errors and Discord outages suspend cleanup. When continuity cannot be established, an empty channel receives a full new interval; outages may therefore extend its lifetime.

A creation may succeed at Discord just before PICKET loses both the response and the opportunity to persist its identifier. That operation is marked **awaiting verification** and is not automatically repeated. PICKET does not identify channels by name alone. An officer may need to resolve this exceptional case. There is no audit-log access.

Discord offers no atomic “delete only if empty” API: PICKET rechecks its reliable occupancy immediately before deletion, but an exactly simultaneous join remains a platform race.

## Permissions and privacy

PICKET needs **Manage Channels** and **View Channel** on the destinations. Existing server administrators must grant Manage Channels to the bot role; changing installation defaults does not update existing roles. Channels inherit category permissions. If effective permissions prevent managing a voice channel, its destination is unavailable.

This feature requests no **Connect**, **Speak**, **Move Members**, **View Audit Log**, **Administrator**, or new Gateway intents. It uses the existing `Guilds` and `GuildVoiceStates` event stream independently of the optional Stats module. PICKET never joins the voice call or receives its audio.

Operational presence contains identifiers needed to recognize arrivals and departures, with no additional member movement history. Drafts expire after 15 minutes; completed operational channel records are eligible for cleanup after 24 hours. Uncertain creations retain their quota reservation until resolved. All feature data follows the server deletion lifecycle.

The server data export includes **only the names of current templates** for this feature. Template options, drafts, deployments, presence, verification timestamps and cleanup state are excluded. It is an informational export, not a template backup.

An officer can select an uncertain creation in **Open channels**, then use **Close tracking** after checking Discord. Confirmation releases the reservation and does not delete any Discord channel.
