# Snap! for Calliope mini

[Snap!](https://snap.berkeley.edu) with a library for the Calliope mini, built
as a static site for [Calliope Campus](https://github.com/calliope-edu/calliope-campus).
Snap! itself is a fixed release of [jmoenig/Snap](https://github.com/jmoenig/Snap),
included unchanged; this repository adds the Calliope mini blocks and the pages
Campus embeds.

The Calliope mini blocks are the ones of the Calliope Blocks editor, with the
same German labels, and reach the device the way it does: Snap! has no
Bluetooth or USB code of its own. Campus connects the Calliope mini with its
connection widget and forwards Snap!'s device access to it (see below). Opened
on its own, outside Campus, Snap! reaches no device.

The library started from the one in
[snap-schule](https://github.com/sparks4school-Foundation/snap-schule)
(`snap-libraries/calliope/`, by Jörn Alraun).

## Build

Needs Node.js 18 or newer, nothing to install.

```bash
npm run build      # downloads Snap! once into .cache/, builds into dist/
npm run dev        # build, then serve dist/ at http://localhost:8610/
```

- **Build command:** `npm run build`
- **Output directory:** `dist`

That is all a Cloudflare Pages project needs (framework preset "None"). The Snap!
version is `snapVersion` in `package.json`. Files over 25 MiB (the Snap! manual
in `help/`) are left out, Pages does not take them.

## What `dist/` holds

| Path | What |
|---|---|
| `snap/` | the Snap! release, unchanged, plus the library in `snap/libraries/` (`calliope/calliope.js`, `calliope/template.xml`, `calliope_module.xml`, an entry in `LIBRARIES.json`) |
| `campus.html` | Snap! for Campus: German, no cloud, the library preloaded, the start project open. Embedded with `?parentOrigin=…` it talks to Campus by postMessage; on its own it is plain Snap! with the library. |
| `render.html` | preview pictures of projects (Live Wall, program cards) |
| `bridge/` | the scripts of both pages |
| `index.html` | forwards to `campus.html` |

`campus.html` and `render.html` load the scripts of the release's `snap.html`,
without its service worker and its tracking.

## How Campus talks to it

Snap! has no postMessage interface; `bridge/campus.js` translates the messages
into Snap!'s JavaScript API (`src/api.js`), which works on Snap!'s own origin.
Messages go only to `parentOrigin`, and only messages from the parent window on
that origin count.

| Direction | Message | Meaning |
|---|---|---|
| Campus → Snap! | `snap.load {xml, key}` | open a project; an empty `xml` opens the start project |
| | `snap.setActive {active}` | `false` pauses Snap! completely while Campus shows another editor |
| | `snap.readonly {readonly}` | lock editing (see below) and report no changes |
| | `snap.requestProject` | answer with `snap.changed` right away |
| Snap! → Campus | `snap.ready` | the IDE is up |
| | `snap.loaded {key, xml, fromTemplate}` | the project is open, `xml` as Snap! saves it |
| | `snap.changed {key, xml}` | the project changed (about a second after the last edit) |
| | `snap.save {key, xml}` | the user saved (Ctrl+S, file menu) |
| | `snap.runtimeVersion {runtimeVersion, hardware}` | what the device's Blocks program reported |

Device access is the Blocks editor's (its `CalliopeRemote` in scratch-vm, and
`calliopeRemoteHost.ts` in Campus): `calliope/calliope.js` is a puppet of the
host, which owns the connection.

| Direction | Message | Meaning |
|---|---|---|
| Snap! → Campus | `calliope.read {serviceId, characteristicId, reqId}` | read a characteristic |
| | `calliope.write {serviceId, characteristicId, message, encoding, withResponse}` | write one (base64) |
| | `calliope.subscribe {serviceId, characteristicId}` | notifications; the host keeps them across reconnects |
| Campus → Snap! | `calliope.readResult {reqId, message}` | the bytes; empty without a device |
| | `calliope.notify {characteristicId, message}` | a notification |
| | `calliope.setActive {active}` | `false`: no device access while another editor shows |
| | `calliope.rehandshake` | read COMMAND again and report the runtime version (after a reconnect or flash) |
| | `calliope.onConnect` | a Blocks program got connected: show "C" on the mini, fire "Wenn Calliope mini verbunden ist" |
| | `calliope.rearmInputs` | arm touch pads and pin events anew |
| | `calliope.disconnect` | forget what the device reported |

The device protocol is the Blocks firmware's, as the Blocks editor's
`calliopeMini` extension speaks it: COMMAND (0x0100) for commands and the
handshake (hardware, protocol, route, runtime version, armed touch pads and pin
events), STATE (0x0101) and MOTION (0x0102) for the sensors (notified from
runtime version 2 on, polled before), SENSOR_EVENT (0x0110) for button, gesture
and pin events, ANALOG_IN (0x0120) for P0..P3.

Read only: Snap! knows no such mode. The page locks dragging, editing inputs,
context menus and typing blocks, hides the palette and reports nothing; scripts
can still be clicked and run.

The render page takes `{type: 'rendersnap', id, project}` and answers with
`{source: 'snap-calliope-render', type: 'rendersnap', id, png, width, height}`
(or `error`), after a first `renderready`. The picture shows the scripts of the
sprite selected when the project was saved, else of the stage, else of any
sprite; without scripts, the stage.

## The library

`calliope/build-library.js` generates `calliope/calliope_module.xml` (the blocks)
and `calliope/template.xml` (the start project) from its block table:

```bash
npm run library
```

The Calliope mini needs the Blocks program (the same as for the Blocks editor).

## Trying it without Campus

`npm run dev`, then <http://localhost:8610/dev/host.html>: a test host that
embeds `campus.html` like Campus does, logs the messages and plays a Calliope
mini (connect, button A; it shows the display and the RGB LEDs).

## License

[AGPL-3.0](LICENSE), like Snap!.
