# Publish to BrewPage (Apple Shortcut)

An Apple Shortcut that publishes one text or file to [brewpage.app](https://brewpage.app) from the share sheet
(iPhone, iPad, Mac) or as a Finder Quick Action (Mac) and returns the link.

**Status:** source and unsigned build only. Shortcuts imports signed files; signing, hosting the signed file and
device runs are separate steps that have not happened yet.

## Files

| File | What it is |
|---|---|
| `build.py` | The source: Python 3 standard library only (`plistlib`). Writes the two generated files below. |
| `Publish to BrewPage.unsigned.shortcut` | Generated, unsigned shortcut (binary property list, the format Shortcuts exports). |
| `ACTIONS.md` | Generated, human-readable list of every action, the top-level keys and where each identifier comes from. |
| `test_build.py` | Standard library `unittest`: byte-identical rebuild and the flow rules below. |

Build and check:

```sh
python3 -I modules/shortcuts/build.py
python3 -I modules/shortcuts/test_build.py
plutil -lint "modules/shortcuts/Publish to BrewPage.unsigned.shortcut"   # macOS
```

Keys are sorted and every action UUID is derived from a fixed name (UUID v5), so the same source always gives
the same bytes. The test fails when the committed files differ from a fresh build.

## What it does

The full list with every step is in [ACTIONS.md](ACTIONS.md). In short:

1. More than one item: an alert, then it stops. Run with no input: it asks for text.
2. Reads the current limits from `GET /api/limits`.
3. Text (plain or rich): choose Markdown (first), Plain text or HTML. File: its size limit follows its kind,
   by extension, the same way the server picks it (video, audio, other). Items over the limit stop here.
4. Choose who can open it: Unlisted (first) or Public (gallery and search).
5. Choose how long it stays: 15 days (first), 1 day, 7 days or the maximum the limits allow.
6. A confirmation alert names brewpage.app, the access, the retention and the size limit, with Cancel.
   Nothing is uploaded before this alert.
7. Uploads text as JSON `{content, format}` to `POST /api/html`, a file as the form field `file` to
   `POST /api/files`. `ns=public` is sent only when Public was chosen.
8. A response with `link` counts as published: the link is copied with Local Only (no Universal Clipboard),
   then the link and `expiresAt` are shown with Open, Show private management link and Done. Otherwise
   it shows the server's `message` and, when present, `retryAfterSeconds`.

Every request carries `X-BrewPage-Client: shortcuts/1`; the system User-Agent is left as is.
The owner token is never read, sent or stored, and the shortcut saves nothing. The management link is
only displayed on request, never copied.

## Provenance

Identifiers and parameter keys were observed on macOS 27.2.1 (26B131), Shortcuts 10.0 (5114.0.6.204), from the
system's own Shortcuts frameworks; `ACTIONS.md` gives the source line for each identifier.

- Action definitions: WorkflowKit's action registry (`WFActionRegistry`) returns each action's definition
  with its parameter keys, classes and allowed values. Four actions (count, alert, copy to clipboard,
  get dictionary value) are defined only in ActionKit, which loads only in Apple-signed processes;
  their keys come from the parameter summary strings the system ships, for example
  `Count ${WFCountType} in ${Input}`.
- Round trip: the unsigned file loads through `WFWorkflowFile` and `WFWorkflow` without an error.
  Every parameter value whose parameter is defined in WorkflowKit parses and serializes back byte-equal through
  its own parameter-state class; each If condition decodes to the intended operator.
- Shapes checked the same way: a form field of type File serializes as a `WFTokenAttachmentParameterState`;
  a file size converts to a number of bytes, while its text form is localized (for example `5,2 MB`);
  `WFWorkflowMinimumClientVersionString` gates import ("created on a newer version"),
  `WFWorkflowClientVersion` does not.
- Top-level keys: Apple's writer (`WFWorkflowRecord` file representation) writes back exactly this
  set of keys.

No code or data comes from third-party shortcut compilers.

## Not verified yet

Signing, the signed file's content, and runs on iPhone, iPad and Mac (permission prompts, Cancel uploading
nothing) need an Apple account and a device.

## License

Apache-2.0, as the rest of this repository.
