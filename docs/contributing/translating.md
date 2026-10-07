# Translating

To add a language or improve a translation, submit a pull request with a **UTF-8 JSON file in i18next format**, placed in `packages/i18n/locales/`.

## Prepare the file

1. Copy `packages/i18n/locales/en.json`, the English source catalog. To correct an existing translation, edit its file directly.
2. Name the new file using the **Discord locale code**, for example `it.json`, `de.json`, `es-ES.json` or `pt-BR.json`.
3. Translate every text value, preserving the file’s structure and keys, including plural variants such as `_one` and `_other`.
4. Submit the file in a pull request describing the language added or the corrections made.

## Rules to follow

- Keep variables such as `{{count}}`, `{{date}}` or `{{name}}` without renaming or removing them.
- Keep command names unchanged: `/picket settings`, `/timers add`, etc.
- Preserve Markdown and Discord tags, such as `**text**` or `<t:{{timestamp}}:F>`.
- Keep command descriptions, option descriptions and choices within **100 characters**; no translation should be empty.

CI checks keys, catalog coverage, variables and length limits. Once merged and deployed, the language appears in `/picket settings` → **Language** and is available in automatic mode. No code changes are needed.
