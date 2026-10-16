# Changelog

## 1.1.0 (unreleased — acceptance testing)

- Acceptance candidate `1.1.0-rc.4`: offer quantities from 1 to 6 at most, reduced to remaining deployment and server capacity; explain server quota refusals with current, requested and excess counts.
- Split the English and French documentation navigation into Guide and Features.
- Acceptance candidate `1.1.0-rc.3`: group voice channels by template and number, including subsequent deployments and recovery after positioning failures.
- Acceptance candidate `1.1.0-rc.2`: cancelling voice preparation removes its private message and invalidates old controls.
- Use one voice channel name for the template, with category first in the four-field form; preserve existing templates when extending name capacity.
- Add temporary voice channels through `/voice create`: choose officer-defined templates and quantities, build a private queue and deploy together.
- Configure templates through `/voice settings`, with a return to PICKET settings; choose from the complete template list without a search step.
- Group temporary voice channels alphabetically by template and numerically within each category, including later creations; retry positioning safely after interruptions.
- Add the enabled-by-default module to `/picket settings`, with at most 10 templates per server, category selection, capacity 1–99 (default 99) and continuously empty cleanup after 1–30 minutes (default 15).
- Default to 6 channels per deployment, configurable up to 10, with a hard server ceiling of 15 open or reserved channels.
- Persist deployment requests, channel tracking and private drafts. Resume cleanup after restart, pause on uncertain occupancy and avoid blindly repeating ambiguous creations.
- Reuse the existing Gateway intents and add Manage Channels to installation requirements. No audit-log access or voice connection is requested.
- Include template names only in server exports; keep operational channel state and template options internal.
- Localize the feature in all six supported languages and document the EN/FR setup, usage and recovery behavior.
