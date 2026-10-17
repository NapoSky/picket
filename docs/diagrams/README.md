# Documentation diagrams

Four diagrams, each authored in French and English, are generated with the supplied Archify 3.1.0 archive.
The JSON specifications contain repository-relative source references pinned to a Git revision. The standalone
HTML embeds its SVG, CSS, JavaScript and font; it requires no CDN or local filesystem access.

The architecture renderer provides the two overviews: ten responsibility groups for the stack and eight
steps/outcomes for data. The data page keeps its overview visible and offers two collapsed explanations:
`guild-data-export` uses Dataflow to compare functional data families with their exported representation;
`guild-data-retention` uses Workflow to distinguish cleanup, tracking opt-out, individual erasure, bot removal
and requested server deletion. Ordinary copies flow directly to the export; only meaningful selections and
transformations have their own processing node. Exclusions and behavior-changing conditions remain visible
in the default reading view, without relying on hidden tags or cards.

Functional descriptions accompany each detailed diagram. SQL tables, fields and exact retention rules remain
in nested reference sections; backups and downloaded copies have their own explanation. The full container
inventory remains expandable on the architecture page. The two overviews retain their explicitly disabled
motion; the new diagrams use Archify's default playback controls. French uses a complete translation catalog;
English overrides only the diagram-specific category labels and export wording.

Regenerate from the repository root with Node.js, `unzip`, and Chrome or Chromium available:

```sh
pnpm docs:diagrams /path/to/archify.zip
```

If Chrome is absent from `PATH`, set `ARCHIFY_CHROME` to its executable. The archive defaults to
`draft/pra-example/archify.zip` when present; `draft` is ignored and the archive is not needed to build or host the docs.
No Archify update is installed by the regeneration script.

Generation is sequential. Each run uses a fresh ignored `.archify` directory for the extracted skill, HTML staging,
delivery metadata and browser receipts. Only HTML that passed specification validation, delivery, strict artifact
checks and browser checks is copied into `docs/public/diagrams`. `checks.json` records hashes and gate results with
portable paths and the generator version. Machine-specific receipts are never copied to the public directory. Embedded viewer/font licenses
are preserved in `docs/public/diagrams/NOTICE.txt`.

When behavior changes, inspect the source, update the specifications and their pinned revision, regenerate, and
review both languages. Browser checks are distinct from a visual inspection: the portable receipt does not assert
that a human inspected screenshots.

`ArchifyDiagram.vue` uses VitePress `withBase` so embedded pages and full-size links work at `/`, under `/picket/`, or
under another GitHub Pages repository prefix. Published diagrams contain no machine-specific absolute paths.
