# Changelog

## 1.1.0 — 2026-10-16

- Add temporary voice channels through `/voice create`: choose officer-defined templates and quantities, build a private queue and deploy together.
- Split the English and French documentation navigation into Guide and Features.
- Limit quantity choices to 1–6 and the remaining deployment/server capacity; report quota refusals with current, requested and excess counts.
- Use one voice channel name for the template, with category first in the four-field form; preserve existing templates when extending name capacity.
- Remove the private preparation message on cancellation and invalidate its old controls.
- Configure templates through `/voice settings`, with a return to PICKET settings; choose from the complete template list without a search step.
- Group temporary voice channels alphabetically by template and numerically within each category, including later creations; retry positioning safely after interruptions.
- Reuse the smallest available channel number after removal while keeping in-progress or uncertain numbers reserved, including concurrent deployments and restarts.
- Add the enabled-by-default module to `/picket settings`, with at most 10 templates per server, category selection, capacity 1–99 (default 99) and continuously empty cleanup after 1–30 minutes (default 15).
- Default to 6 channels per deployment, configurable up to 10, with a hard server ceiling of 15 open or reserved channels.
- Persist deployment requests, channel tracking and private drafts. Resume cleanup after restart, pause on uncertain occupancy and avoid blindly repeating ambiguous creations.
- Reuse the existing Gateway intents and add Manage Channels to installation requirements. No audit-log access or voice connection is requested.
- Include template names only in server exports; keep operational channel state and template options internal.
- Localize the feature in all six supported languages and document the EN/FR setup, usage and recovery behavior.
