# War log

PICKET watches Foxhole's public War API and posts changes in a regular text channel. Collection is shared across
servers; each server chooses its own geographic coverage. The feature is **disabled by default**.

## Configure your subscription

An officer runs `/warlog settings`. In the private panel:

1. Choose a **regular text channel** where PICKET can View Channel, Send Messages and Embed Links. Announcement
   channels, threads, forums and voice channels are not accepted.
2. Select **one to three zones**: West Islands, West Coast, Centre, East Coast or East Islands. These five zones
   group the game's 53 known regions. Click a zone again to remove it.
3. Choose the **reference faction**: Neutral (default), Colonials or Wardens. It controls special-alert colors without
   filtering events by faction. This choice is kept between wars.
4. Choose **Confirm and enable**. The current war must be available to enable the subscription.

One destination is supported per server. Selecting several zones sends their events into that same channel. The panel
is restricted to its owner and expires after 15 minutes; reopen the command when necessary. Language follows the server
setting, then the Discord server's language saved when choosing the channel, then English.

Each ordinary event is a separate, silent, one-line message, including faction, game timestamp, region, structure and
location. Structures under initial construction are omitted; upgrades and captures are published. Storm Cannons,
Intelligence Centers and Weather Stations observed being built receive estimated concrete notifications after 48, 24
and 24 hours. The text says the concrete **may have dried**, because the API does not reveal the true construction time.

## Special alerts and colors

These events use individual embeds with region, location, game time and perspective:

| Event | Format |
| --- | --- |
| Storm Cannon built or destroyed | Embed |
| Launch site detected, armed, disarmed or destroyed | Embed |
| Nuclear target detected or removed | Embed |
| Nuclear impact or impact marker removed | Embed |
| Scorched structure | One embed per structure |
| War ended | Embed in the winner's faction color |
| Captures, losses, upgrades, IC/WS and concrete drying | Text line |

Green means **favorable** for the server; red means **unfavorable**. An allied launch site being armed is green; an enemy
site being armed is red. Losing an allied Storm Cannon is red; destroying an enemy Storm Cannon is green. For scorched
structures, faction identifies the previous owner, not the launcher. The footer states Allied / Enemy and Favorable /
Unfavorable so the meaning does not depend on color alone.

Neutral perspective or unknown event ownership produces gray alerts. Removing an old impact marker is always gray:
it does not indicate a new military outcome. The war-end announcement uses the winner's faction color regardless of
perspective. Impacts and scorched structures are not grouped: one event remains one message. Colonial and Warden emojis
always identify the event's actual faction. All messages, including embeds, are silent.

## Change coverage or pause

Changing channel, zones or reference faction cancels pending messages for the old configuration. Removing the final zone also disables the
subscription. Disabling and later re-enabling receives **new events only**, without replaying the disabled period.
An API call already sent to Discord can still finish after a configuration change.

## Confirm for every new war

At the start of a new war, subscriptions become inactive. Previously subscribed servers receive one invitation in
their old channel to open `/warlog settings`. The channel and zones stay prefilled: review or change them, then confirm
and enable for the current war. There are no periodic reminders and no retroactive event replay.
The reference faction is preserved and does not need to be selected again.

A restart within the same war does not require confirmation again. A new war discovered after an outage still requires
renewal. Optional timer-board resets are configured separately in `/timers settings` and do not depend on renewing the
war-log subscription.

## Interruptions

If collection fails, PICKET pauses the feed and retries. It reloads the complete public map as a new baseline and then
publishes subsequent changes. Changes during the outage and pending messages from before recovery are not replayed.
An incomplete map response never means that its structures disappeared.

The delivery target for an isolated detected event is two minutes under supported, healthy operation. It does not
include time before the API exposes the change and cannot cover API outages, inaccessible channels or sustained
overload. Delivery is paced to share Discord's allowance with timers and other bot operations.

If a channel is removed, converted to an unsupported type, or rejects messages because of permissions, its subscription
is paused. Choose a valid channel and enable again. `/warlog settings` remains available while the subscription is off.

## Stored data

Public game state and recorded events are retained for the current and preceding observed wars. Server data includes
channel, zones, reference faction, language, activation for a war, delivery state and configuration audit entries. Server export and deletion
in `/picket settings` include these records. Shared public game data is independent of a server's deletion; Discord
messages are not automatically deleted. See [Privacy Policy](../legal/privacy).

For game-data updates, compare active map names and icon types with the official War API documentation, update
`packages/game-data/src/domain/war-catalog.ts`, increment `WAR_DATA_VERSION`, and run the catalogue and transition tests.
