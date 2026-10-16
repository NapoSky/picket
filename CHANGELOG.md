# Changelog

## 1.1.0 (unreleased — acceptance testing)

- Add temporary voice channels through `/picket voice`: choose officer-defined templates and quantities, build a private queue and deploy together.
- Add the enabled-by-default module to `/picket settings`, with at most 10 templates per server, category selection, capacity 1–99 (default 99) and continuously empty cleanup after 1–30 minutes (default 15).
- Default to 6 channels per deployment, configurable up to 10, with a hard server ceiling of 15 open or reserved channels.
- Persist deployment requests, channel tracking and private drafts. Resume cleanup after restart, pause on uncertain occupancy and avoid blindly repeating ambiguous creations.
- Reuse the existing Gateway intents and add Manage Channels to installation requirements. No audit-log access or voice connection is requested.
- Include template names only in server exports; keep operational channel state and template options internal.
- Localize the feature in all six supported languages and document the EN/FR setup, usage and recovery behavior.
