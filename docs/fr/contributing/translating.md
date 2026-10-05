# Traduire

PICKET est traduit avec [Weblate](https://weblate.org). L'anglais est la langue source ; le français est fourni. Chacun
peut ajouter une langue.

## Fonctionnement

- Les textes sont dans `packages/i18n/locales/<langue>.json`, un fichier par langue. Le **nom du fichier est le code de
  langue Discord** (`fr`, `de`, `pt-BR`, `es-ES`…).
- Weblate surveille ces fichiers. Ses modifications arrivent sous forme de pull requests qui ne touchent qu'eux, et sont
  fusionnées automatiquement une fois les contrôles passés.
- Une langue est prise en compte par le bot dès que son fichier existe : il n'y a rien à déclarer dans le code.
- Une traduction manquante retombe sur l'anglais, donc une traduction partielle convient.
- La liste de `/picket settings language` affiche chaque langue sous son propre nom et Discord la limite à 25 entrées,
  « Automatique » compris : au-delà de 24 langues, cette commande devra passer par l'autocomplétion.

## Règles contrôlées par la CI

| Règle | Pourquoi |
| --- | --- |
| Le nom du fichier est un code de langue Discord valide | Les descriptions de commandes sont envoyées à Discord par langue. |
| Aucune clé absente de l'anglais | Une faute de frappe ne serait jamais utilisée, sans erreur visible. |
| Mêmes `{{variables}}` que le texte anglais | Une variable manquante ou renommée casse le message. |
| Descriptions de commandes, d'options et choix de 1 à 100 caractères | Limite de Discord. |
| Aucune valeur vide | Un message vide n'est jamais voulu. |

Laissez les variables comme `{{date}}` ou `{{target}}` intactes, et gardez tels quels les noms de commandes littéraux
(`/picket data cancel-deletion`, `confirm:True`).

## Travailler en local

```sh
pnpm exec jest packages/i18n     # contrôle tous les catalogues
pnpm i18n:keys                   # après avoir ajouté ou renommé une clé dans en.json
```

`pnpm i18n:keys` régénère le type `MessageKey` utilisé par le code, et les tests échouent s'il est périmé.

## Configurer Weblate (mainteneurs)

Créez un composant avec :

| Réglage | Valeur |
| --- | --- |
| Masque de fichier | `packages/i18n/locales/*.json` |
| Fichier de langue de base monolingue | `packages/i18n/locales/en.json` |
| Format de fichier | i18next JSON file (v4) |
| Méthode de push (réglages du dépôt) | GitHub pull request |
| Modules de traduction automatique | Désactivés |

Renseignez ensuite la variable de dépôt `WEBLATE_BOT_LOGIN` avec le compte qui ouvre les pull requests, activez **Allow
auto-merge** dans les réglages du dépôt, et exigez les contrôles de la CI dans la protection de branche de `main`. Sans
cette variable, rien n'est fusionné automatiquement.
