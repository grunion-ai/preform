# preform

Formlabs PreForm from the command line. `preform` drives the [Formlabs Local API](https://github.com/formlabs/formlabs-api-python) through PreFormServer, the headless build of PreForm, so a folder of models becomes a validated `.form` job or a print on a Form 4 or Fuse without opening the GUI.

Node 20 or newer. No dependencies.

## Install

```bash
npm install -g @grunion-ai/preform
```

PreFormServer ships separately from Formlabs. The installer fetches the newest build for this machine from the [Formlabs API downloads page](https://formlabs.com/support/Formlabs-API-downloads-and-release-notes), checks the Developer ID signature (Formlabs Inc., team KVPE3R79SR) and installs it:

```bash
npx --package @grunion-ai/preform preform-install
```

From a checkout: `node scripts/install-preformserver.mjs [--dest /Applications] [--version 3.63.0] [--force]`. Any other location works through `PREFORM_SERVER=/path/to/PreFormServer`. Verified with PreFormServer 3.63.0 (API 0.9.30, Apple Silicon build) on 2026-09-22: `prep` on a 20 mm cube for Form 4 Black V5 at 0.1 mm returns a 2,766 s estimate and a 240 KB `.form` in about 3 s.

PreFormServer lists thirteen built-in virtual printers (`preform devices`, `connection_type` `VIRTUAL`, addresses in 192.0.2.0/24). `preform print <scene> --printer "Form 4"` uploads to one and returns a job id, which makes them a stand-in for a real printer in scripts and tests.

## Prepare a job in one command

```bash
preform prep bracket.stl --printer FORM-4-0 --material FLGPBK05 --layer 0.1 --out bracket.form
```

`prep` creates a scene, imports each model, auto-orients, auto-supports, auto-lays out, runs print validation, estimates print time, saves the `.form` file and deletes the scene. The result is JSON on stdout: scene id, imported models, validation per model, the estimate in seconds, and the saved path. Progress goes to stderr.

Flags: `--no-support` skips supports (SLS printers, or parts you support by hand), `--keep` leaves the scene open in the server for further calls, `--fps settings.fps` uses a saved print-settings file in place of `--printer`/`--material`/`--layer`.

## Step by step

```bash
preform scene new --printer FORM-4-0 --material FLGPBK05      # -> {"id": "..."}
preform import <scene> bracket.stl --name Bracket
preform orient <scene>
preform support <scene> --raft MINI_RAFT
preform layout <scene>
preform validate <scene>
preform estimate <scene>
preform save <scene> bracket.form
preform screenshot <scene> bracket.png
```

`orient`, `support` and `layout` take `--models id,id` to act on a subset; the default is every model in the scene.

## Printers and materials

```bash
preform devices                      # printers PreForm already knows
preform discover --timeout 10        # scan the local network
preform materials --printer FORM-4-0 # material codes and print settings for one printer type
preform print <scene> --printer Form4-3XK2 --name "Bracket x4" --now
```

`--printer` on `print` takes a printer name, serial or IP address. Without `--now` the job uploads to the printer's queue and waits for a start on the touchscreen.

## Anything else in the API

```bash
preform api GET /scenes/
preform api POST /scene/<id>/hollow/ '{"models":"ALL","wall_thickness_mm":2}'
preform api DELETE /scene/<id>/
```

`api` sends any method and path with an optional JSON body and prints the response. Long operations run asynchronously: the CLI submits with `?async=true` and polls `/operations/<id>/` until the job succeeds or fails. `--no-wait` returns the operation id instead, and `preform op get <id>` reads it later.

## Server

Every command checks `--url` (default `http://localhost:44388`, or `PREFORM_URL`). A command that finds nothing listening starts a PreFormServer from the binary it locates, runs, and stops it again. For a batch of commands, keep one running:

```bash
preform serve --port 44388
```

## Output and exit codes

Every command prints JSON to stdout, pretty by default and single-line with `--json`. Errors print the Formlabs error code and message to stderr and exit 1; unknown commands and a missing server exit 2.

## Development

```bash
npm test
```

Tests run against a fake PreFormServer in-process, so they need no Formlabs software installed. `node scripts/make-cube.mjs` regenerates the STL fixture. The Local API spec these commands follow is `formlabs-api-local-openapi.yaml` version 0.9.22 in the Formlabs repository; PreFormServer 3.63.0 reports API 0.9.30 and does not serve its spec over HTTP, so field names come from the 0.9.22 file plus live responses.

## License

MIT. PreForm and PreFormServer are Formlabs software under the [Formlabs API license](https://support.formlabs.com/s/article/Formlabs-API); this tool only talks to them.
