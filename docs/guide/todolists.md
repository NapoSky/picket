# Todo lists

Prepare a convoy, gather crates or share tasks before an operation: a todo list gives your group a shared checklist
right in Discord. Each task has a button; members click as they make progress, and everyone sees what remains.

You can group tasks into categories and specify quantities. When every task in a message is done, PICKET deletes
that message: only pages that still need work remain in the channel.

## Who can do what?

These are **PICKET access levels** configured for your server, rather than your ranks in the game.

| Access | What you can do |
| --- | --- |
| **Member** | Create a list and tick tasks on any server list you can access. |
| **Officer** | Everything a member can do, plus enable or disable Todo lists in `/picket settings`. |
| **Discord administrator** | Everything an officer can do, plus manage access roles and export or delete server data. |

By default, all server members can use todo lists. An administrator can adjust access in `/picket settings` →
**Permissions**. See the [permissions guide](./permissions) for details.

A list is shared with the group: **ticking tasks is not reserved for its creator**, and there are no per-list
permissions. Discord channel access and PICKET roles determine who can take part.

## Your first list

1. In the channel where your group coordinates, run **`/todolist create`**.
2. Fill in the form with one task per line. You can copy this example:

   ```text
   __Convoy preparation__
   A - Ammunition crates (x3)
   A - Trucks
   Reminder: departure at 9pm
   ```

3. Submit: PICKET posts the list, with one button for crates and another for trucks.
4. Click the crates button after each delivery: **3 → 2 → 1 → done**. The trucks button needs one click. When both
   tasks are done, the message is deleted.

Start each task with **`A - `**: an uppercase letter, a dash and a space before the text. You can repeat `A -` on
every line: PICKET assigns button letters in task order for you. A dash alone (`- Crates`) remains free text and
does not create a button.
**`__Convoy preparation__`** creates a category title; a line such as `Reminder: departure at 9pm` stays a reminder.

The bot needs **View Channel**, **Send Messages** (or **Send Messages in Threads**) and **Embed Links**. PICKET points
out a missing permission before opening the form.

## Working through the list together

A click ticks a task or reduces its quantity by one. The message updates for everyone, without a private confirmation
for every click. When a page is finished, the person completing it receives a private confirmation. If a task is
already done when you click, PICKET lets you know.

Simultaneous clicks count: two people delivering one crate each can reduce the quantity by two. You do not need to
wait for the other person to finish clicking.

A large list is automatically split across messages, with a marker such as **📋 2/3**. Each page is completed and
deleted independently. The confirmation tells you which page is done; it does not mean every page is finished.
Category titles are repeated when a category continues on the next page.

An officer can disable Todo lists in `/picket settings`. Messages stay in Discord, but their buttons stop working
while the module is disabled. Access is checked again for every click.

## Organizing your list

### Categories, quantities and reminders

Use titles to separate stages, and free text for instructions that do not need to be ticked:

```text
__Preparation__
A - Crates (x2)
A - Trucks
Reminder: briefing at 9pm
__Combat__
A - Ammunition
```

The **`(x3)`** suffix needs three clicks. `(x1)` disappears because one click is already enough. Quantities of `(x0)` or
more than 999 are not interpreted: they stay in the task's text.

Two tasks with the same text in the same category are merged: `Crates (x2)` and `Crates` become `Crates (x3)`. If their
sum exceeds 999, they stay separate. The same text in two categories also stays separate. Reminders and titles stay
in their original positions.

::: details Other accepted input formats

| You type | It becomes |
| --- | --- |
| `A - Crates`, `A: Crates`, `A・Crates`, `A·Crates` | A task you can tick |
| `🇦 Crates`, `🇦- Crates`, `🇦: Crates`, `:regional_indicator_a: - Crates` | A task you can tick |
| `__Preparation__`, `__**Preparation**__`, `**__Preparation__**` | A category title |
| `**Preparation**` followed by a task, possibly after blank lines | A category title |
| `Reminder: briefing at 9pm`, `R-12 Hauler`, `**Info**` alone | Free text |

Plain letters must be uppercase. After a plain letter, the `-` and `:` separators need a space (`A - Crates`,
`A: Crates`): `R-12 Hauler` or `A-10` stay free text. The letter you type does not determine the button: PICKET assigns
🇦, 🇧, 🇨… in task order.

:::

## Limits

| Limit | Value |
| --- | --- |
| Form input | 4,000 characters |
| Tasks per list, after merging | 100 |
| Task text | 300 characters |
| Recognized category title | 100 characters; longer titles remain free text |
| Tasks per message | At most 25; fewer if the content length requires it |
| Interpreted quantity per task | From 1 to 999 |
| Lists per server | No PICKET quota; Discord's rate limits apply |

PICKET adds the messages needed to display the list. A list of 26 tasks therefore needs at least two messages;
you do not need to run the creation command again.

A ticked task **cannot be reopened**, and quantities can only decrease. There is no editor for adding tasks to a
published list: create a new list if you need to change its content.

## If something goes wrong

| Situation | What to do |
| --- | --- |
| The form is refused | PICKET explains why and returns your text to copy: check that it contains a recognized task and meets the limits. |
| A line has no button | Use a format such as `A - Crates`, with an uppercase letter and a space after the dash. `- Crates` alone remains free text. |
| You cannot create a list or click | Check your PICKET roles, whether Todo lists is enabled and the channel's Discord permissions. |
| A click is reported as temporarily busy | Wait a moment, then try again. |
| A list message was deleted manually | PICKET cannot restore its content or progress. Create a new list. |
| An error appears during publishing, particularly after the bot stops | Check the channel first: some pages may already have been posted. Avoid creating duplicates by immediately trying again. |

## What PICKET stores

**Task text, categories, reminders and progress live in Discord messages.** PICKET does not save them in its database.
Deleting a message therefore deletes that page of the list.

PICKET does keep **creation metadata**: server, creator, channel and published message identifiers, creation time and
page count. Application logs may also record the clicking user's identifier, the message identifier, the task's
position and the action's outcome, without the list's content. **These database logs have a 30-day retention period.**

If an audit channel is configured, PICKET reports **list creation** there, with a link to its message and the page
count, without copying the tasks. Clicks are not posted in that channel. The 30-day log retention does not delete
lists or audit messages already posted in Discord.

An administrator can export stored data or request its deletion in `/picket settings` → **Data**. The export includes
retained metadata and logs, rather than list content hosted in Discord. Deleting the bot's data does not automatically
delete these messages. See the [Privacy Policy](../legal/privacy) for the general retention policy.
