# CLAUDE.md

Snap! with the Calliope mini library as a static build for Calliope Campus. The
README explains the layout, the build and the message protocol.

## Rules

- Snap! is included **unchanged**, as a fixed release (`snapVersion` in
  `package.json`), downloaded by `scripts/build.mjs`. Never patch files of the
  release. What Campus needs goes into our own pages and scripts (`pages/`,
  `bridge/`) and uses Snap!'s JavaScript API (`src/api.js`) or wraps its
  prototypes at runtime. A Snap! update is a change of `snapVersion` plus a check
  that the pages still work; Snap! releases come out almost weekly.
- `calliope/calliope.js` has no device code of its own: like the Blocks
  editor's `CalliopeRemote` (scratch-vm `src/io/calliopeRemote.js`) it sends
  every device access to Campus, whose connection widget owns the link. No
  Bluetooth or USB here, no connect/disconnect blocks; outside Campus the blocks
  reach no device. The blocks follow the Blocks editor's `calliopeMini`
  extension (block set, German labels, firmware protocol).
- `calliope/calliope_module.xml` and `calliope/template.xml` are generated: edit
  the block table in `calliope/build-library.js` and run `npm run library`.
- The device protocol must match Campus' `src/lib/blocks/calliopeRemoteHost.ts`
  (calliope-campus) and the Blocks firmware. Message names and shapes are listed
  in the README; change them only together with Campus.
- License AGPL-3.0, like Snap!.
- Language: code, comments, commit messages and docs in English; texts the user
  sees in Snap! (block labels, messages) in German.

## Running it

- `npm run build` builds `dist/` (first run downloads ~130 MB into `.cache/`).
- `npm run dev` builds and serves `dist/` at <http://localhost:8610/>; Campus'
  local editor preset points there. `/dev/host.html` is a test host with a fake
  Calliope mini.
- After changing `bridge/`, `pages/` or `calliope/`, run `npm run build` again;
  the server serves the new files without a restart.

## Deployment

Cloudflare Pages: build command `npm run build`, output directory `dist`.
Campus embeds `campus.html` and `render.html` from there.
