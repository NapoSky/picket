# Todo lists

A todo list is a public message from the bot with one button per item. Anyone allowed to use PICKET clicks a button to
tick the item off; when everything is done, the message removes itself.

The list **lives in the Discord message only**: PICKET stores nothing about it in its database. Deleting the message
deletes the list.

## Creating a list

Run `/todolist create` in the channel where the list should appear, type the items in the form, and submit. The bot
needs the **View Channel**, **Send Messages** (or **Send Messages in Threads**) and **Embed Links** permissions in that
channel; if one is missing, PICKET tells you which before opening the form.

## What you can type

| You type | It becomes |
| --- | --- |
| `A・Crates`, `A·Crates`, `A - Crates`, `A: Crates` (a capital letter, then `・`, `·`, `-` or `:`) | An item |
| `🇦 Crates`, `🇦- Crates`, `🇦: Crates`, `:regional_indicator_a: - Crates` | An item |
| `__Preparation__`, `__**Preparation**__`, `**__Preparation__**` | A category title |
| `**Preparation**` followed by an item | A category title |
| Anything else (`Reminder: briefing at 9pm`, `R-12 Hauler`, `**Info**` alone) | Free text, kept exactly where you wrote it |

- The letter you type is ignored: items are lettered 🇦, 🇧, 🇨… in the order they appear.
- After a plain letter, `-` and `:` need a space (`A - Crates`, `A: Crates`); `R-12 Hauler` or `A-10` stay free text.
- `Crates (x3)` needs three clicks. `(x1)` is redundant and disappears. `(x0)` and quantities over 999 are kept as plain
  text.
- Two items with the same text in the same category are merged and their quantities added: `Crates (x2)` and `Crates`
  give `Crates (x3)`. The same text in two categories is not merged.
- Free text and titles are never moved, reworded or dropped.

Example:

```text
__Preparation__
A・Crates (x2)
B・Trucks
Reminder: briefing at 9pm
__Combat__
C・Ammunition
```

## Limits

| Limit | Value |
| --- | --- |
| Text | 4000 characters |
| Items (after merging) | 100 |
| One item | 300 characters |
| Items per message | 25: longer lists are split over several messages (`📋 2/3` in the footer) |

A text with no item, too many items, or an item that is too long is refused with the reason, and your text is sent back
to you so you can copy it into a new form. A page that would be too long is started earlier, so a message never goes
over Discord's limits, even once every item is ticked.

A list that spans several messages repeats the category title at the top of each message that starts in the middle of
that category.

## Using a list

- Click a button to tick an item (or take one off its quantity). The message updates for everyone; you get no private
  message, except at the end.
- When the last item of a message is ticked, the message is deleted and you are told which page was completed. In a list
  of several messages, each message is independent: PICKET never claims the whole list is finished.
- If two people click at the same moment, **both clicks count**, even when they are handled by different PICKET
  instances. If someone else already ticked the item, you are told so.
- Buttons follow the **member** access level at the time of the click, and the `todolists` feature of the server (see
  [Commands](./commands) and `/picket settings feature`). Disabling the feature stops the buttons of existing lists too.

## Known limitations

- A ticked item cannot be re-opened and quantities only go down. Create a new list instead: the message is the list.
- There is no history of who ticked what in Discord. Operators of an instance can find it in the application logs
  (user, message, item), which hold no list content.
- Anyone at the member level can tick any item; there is no per-list permission yet.
- PICKET does not limit how many lists a server posts: Discord's own rate limits apply.
- If PICKET is stopped while a list is being posted, the form may show an error; check the channel before retrying.
