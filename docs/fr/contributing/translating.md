# Traduire

Pour ajouter une langue ou améliorer une traduction, soumettez une pull request avec un fichier **JSON UTF-8 au format i18next**, placé dans `packages/i18n/locales/`.

## Traductions disponibles

| Langue | Fichier dans `packages/i18n/locales/` |
| --- | --- |
| Anglais (catalogue de référence) | `en.json` |
| Français | `fr.json` |
| Allemand | `de.json` |
| Espagnol | `es-ES.json` |
| Portugais du Brésil | `pt-BR.json` |

Pour améliorer l’une de ces langues, modifiez son fichier existant. Il s’agit des traductions du bot ; la documentation
est disponible en français et en anglais.

## Préparer le fichier

1. Copiez `packages/i18n/locales/en.json`, le catalogue anglais de référence. Pour corriger une traduction existante, modifiez directement son fichier.
2. Nommez le nouveau fichier avec le **code de langue Discord**, par exemple `it.json` pour l’italien, qui n’est pas encore fourni.
3. Traduisez toutes les valeurs textuelles en conservant la structure et les clés du fichier, y compris les variantes de pluriel comme `_one` et `_other`.
4. Soumettez le fichier dans une pull request en indiquant la langue ajoutée ou les corrections apportées.

## Règles à respecter

- Conservez les variables comme `{{count}}`, `{{date}}` ou `{{name}}` sans les renommer ni les supprimer.
- Gardez les noms de commandes tels quels : `/picket settings`, `/timers add`, etc.
- Préservez le Markdown et les balises Discord, par exemple `**texte**` ou `<t:{{timestamp}}:F>`.
- Limitez les descriptions de commandes, d’options et les choix à **100 caractères** ; aucune traduction ne doit être vide.

La CI vérifie les clés, la couverture du catalogue, les variables et les limites de longueur. Après intégration et déploiement, la langue apparaît dans `/picket settings` → **Langue** et est utilisable en mode automatique. Aucun ajout dans le code n’est nécessaire.
