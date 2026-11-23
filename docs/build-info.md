# Build info: channels, `BUILD.json` and the version line

Every Calliope editor build says which version it is, in the same shape, so
Calliope Campus' version overview (`/admin/versions`) can compare every target
against its channel and a teacher or developer can tell at a glance which build
they are looking at. The format comes from calliope-mini-python-editor
(`docs/build-info.md` there); the plan behind it is calliope-campus
`docs/design/2026-editor-channels.md`.

## Channels

| Channel | Built from                          | Build branch | Served at              |
| ------- | ----------------------------------- | ------------ | ---------------------- |
| `live`  | a tag `calliope-vX.Y.Z`             | `build-live` | `snap.calliope.cc`     |
| `dev`   | a push to `calliope-main`           | `build-dev`  | `snap-dev.calliope.cc` |
| `local` | `npm run build`, `npm run dev`      | none         | your machine           |

The workflow `.github/workflows/calliope-build.yml` builds once and commits the
build twice into the build branch: at its root (the site) and under
`editors/snap/` (the path Campus serves its editors under, on its own origin).
The pages only use relative paths, so both are the same files. Nobody commits
to `build-live` or `build-dev` by hand, and they are never rewritten.

Each build branch is served as it is by a Cloudflare Pages project (framework
preset none, build command empty, output directory empty):

| Pages project       | Production branch | Custom domain          |
| ------------------- | ----------------- | ---------------------- |
| `calliope-snap`     | `build-live`      | `snap.calliope.cc`     |
| `calliope-snap-dev` | `build-dev`       | `snap-dev.calliope.cc` |

Preview builds are of no use there (Settings → Builds → Branch control:
production branch only).

## `BUILD.json`

Next to both variants: `/BUILD.json` and `/editors/snap/BUILD.json`, with the
same values.

```json
{
  "channel": "live",
  "version": "calliope-v1.0.0",
  "commit": "4dece3676a97…",
  "builtAt": "2026-11-23T17:00:00Z",
  "ui": null,
  "widget": null,
  "libs": { "snap": "v12.3.11" }
}
```

| Field     | Meaning                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| `channel` | `live`, `dev` or `local`.                                                                     |
| `version` | live: the tag (`calliope-v1.0.0`); dev: the branch (`calliope-main`); local: the branch.      |
| `commit`  | The full source commit.                                                                       |
| `builtAt` | When it was built, UTC, ISO 8601 without milliseconds.                                        |
| `ui`      | calliope-ui's state; `null`: Snap! carries no calliope-ui.                                    |
| `widget`  | The connection widget's state; `null`: Snap! reaches the Calliope mini through Campus.        |
| `libs`    | `snap`: the bundled Snap! release, as its tag in `jmoenig/Snap` (`snapVersion` in `package.json`). |

## Where the values come from

[`scripts/build-info.mjs`](../scripts/build-info.mjs) turns four environment
variables into this object:

| Variable        | Set by the workflow to                     | Without it (local)                |
| --------------- | ------------------------------------------ | --------------------------------- |
| `BUILD_CHANNEL` | `live` for a tag, `dev` for a branch       | `local`                           |
| `BUILD_VERSION` | the tag or branch name (`github.ref_name`) | `git rev-parse --abbrev-ref HEAD` |
| `BUILD_COMMIT`  | `github.sha`                               | `git rev-parse HEAD`              |
| `BUILD_AT`      | once per job                               | now                               |

`scripts/build.mjs` writes it as `dist/BUILD.json` and as the constant
`window.SNAP_CALLIOPE_BUILD` in `dist/build-info.js`, which `campus.html`
loads, so the file and the page always agree.

## The version line

`bridge/version.js` adds one line at the bottom of the Snap! logo menu, below
a separator, black text:

- live: `calliope-v1.0.0 · 7ea9962`
- dev: a framed `dev` mark, then `calliope-main · a1b2c3d`
- local: a framed `local` mark, then the branch and commit

A click opens the commit on GitHub; hovering names the Snap! release and the
build time. Snap! has no calliope-ui or widget, so there is no second line.

## In Campus

Embedded (`?parentOrigin=…`), `campus.html` logs the build once to the console
at startup:

```
[snap-calliope] live calliope-v1.0.0 · 7ea9962 {channel: "live", …}
```

Campus' version overview reads `BUILD.json`.
