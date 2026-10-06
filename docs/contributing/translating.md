# Translating

PICKET is translated with [Weblate](https://weblate.org). English is the source language; French is provided. Anyone
can add a language.

## How it works

- The texts live in `packages/i18n/locales/<language>.json`, one file per language. The **file name is the Discord locale
  code** (`fr`, `de`, `pt-BR`, `es-ES`…).
- Weblate watches those files. Its changes arrive as pull requests that only touch them, and are merged automatically
  once the checks pass.
- A language is picked up by the bot as soon as its file exists: there is nothing to register in the code.
- A missing translation falls back to English, so a partial translation is fine.
- The language menu in `/picket settings` shows each language in its own name. It paginates beyond 24 languages, keeping Automatic on every page.

## Rules checked by the CI

| Rule | Why |
| --- | --- |
| The file name is a valid Discord locale code | Command descriptions are sent to Discord per locale. |
| No key that does not exist in English | Typos would silently never be used. |
| Same `{{placeholders}}` as the English text | A missing or renamed placeholder breaks the message. |
| Command descriptions, option descriptions and choices are 1 to 100 characters | Discord limit. |
| No empty value | An empty message is never what you want. |

Keep placeholders such as `{{date}}` or `{{target}}` untouched, and keep literal command names (`/picket settings`, `/picket status`) as they are.

## Working locally

```sh
pnpm exec jest packages/i18n     # checks every catalog
pnpm i18n:keys                   # after adding or renaming a key in en.json
```

`pnpm i18n:keys` regenerates the `MessageKey` type used by the code, and the tests fail if it is out of date.

## Setting up Weblate (maintainers)

Create a component with:

| Setting | Value |
| --- | --- |
| File mask | `packages/i18n/locales/*.json` |
| Monolingual base language file | `packages/i18n/locales/en.json` |
| File format | i18next JSON file (v4) |
| Push method (repository settings) | GitHub pull request |
| Automatic translation add-ons | Disabled |

Then set the repository variable `WEBLATE_BOT_LOGIN` to the account that opens the pull requests, enable **Allow
auto-merge** in the repository settings, and require the CI checks in the branch protection of `main`. Without the
variable, nothing is merged automatically.
