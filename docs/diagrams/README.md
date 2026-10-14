# Documentation diagrams

Two diagrams, each authored in French and English, are generated with the supplied Archify 3.1.0 archive.
The JSON specifications contain repository-relative source references pinned to a Git revision. The standalone
HTML embeds its SVG, CSS, JavaScript and font; it requires no CDN or local filesystem access.

The architecture renderer is used for both graphs. They are reader-oriented overviews: ten responsibility groups
for the stack and eight steps/outcomes for data. The full container inventory, exported tables and retention rules
are preserved in expandable sections on the documentation pages. Legend and viewer categories are named for each
diagram's meaning (for example retained data, export and deleted data), rather than generic implementation layers.
Motion is explicitly disabled to preserve the static reading experience across generator upgrades. French uses a
complete translation catalog; English overrides only the diagram-specific category labels and export wording.

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
