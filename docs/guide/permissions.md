# Permissions

PICKET uses two levels that you attach to roles, plus an implicit administrator level.

| Level | Meant for | Examples |
| --- | --- | --- |
| `member` | Everyday users of the bot | Check the status, (soon) add a timer or a todo list |
| `officer` | People who manage the bot | (soon) create boards, configure the war log |
| administrator | Server owner and Administrator role holders | Manage permissions, delete the server data |

An officer is also a member. An administrator is also an officer.

## How a level is decided

The first rule that matches wins, and it is checked **every time** someone uses a command (including buttons), not
when something was created.

1. The person has the Discord **Administrator** permission (this includes the server owner): administrator.
2. The person holds a role of the officer list: officer.
3. The person holds a role of the member list, or the member list contains `@everyone`: member.
4. Otherwise access is refused, and the message tells which level is required.

If Discord does not provide the permissions of the person, access is refused: PICKET never allows by default.

## Good to know

- With **no officer role** configured, only administrators can use officer commands. `/picket permissions show` warns you.
- `@everyone` cannot be an officer.
- If you delete a role in Discord, PICKET removes it from the levels on its own and records it in the audit log.
- Discord's own command permissions (Server Settings → Integrations) apply first. PICKET cannot allow what Discord
  already forbids.
