# Publish to BrewPage (Apple Shortcut)

An Apple Shortcut that publishes one text or file to [brewpage.app](https://brewpage.app) from the share sheet
(iPhone, iPad, Mac) or as a Finder Quick Action (Mac) and returns the link.

**Status:** source, unsigned build and a signing and inspection kit. Shortcuts imports signed files; no signed
file is published yet (see [Signing](#signing-and-inspection)), and device runs have not happened yet.

## Files

| File | What it is |
|---|---|
| `build.py` | The source: Python 3 standard library only (`plistlib`). Writes the two generated files below. |
| `Publish to BrewPage.unsigned.shortcut` | Generated, unsigned shortcut (binary property list, the format Shortcuts exports). |
| `ACTIONS.md` | Generated, human-readable list of every action, the top-level keys and where each identifier comes from. |
| `test_build.py` | Standard library `unittest`: byte-identical rebuild and the flow rules below. |
| `sign.sh` | Signs a shortcut with `shortcuts sign --mode anyone` (macOS); refuses every other mode. |
| `inspect_signed.py` | Checks a signed file for anything that identifies the signer and compares its payload with the unsigned build. |
| `test_inspect_signed.py` | `unittest` on files built with the macOS `aea` tool: Apple ID fields, personal values, record id, reused signer. |

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

## Signing and inspection

A signed shortcut is an `AEA1` container: a header, an auth-data property list with the signing certificates,
and the signed payload (an Apple Archive holding `Shortcut.wflow`). Sign and inspect on macOS:

```sh
modules/shortcuts/sign.sh "modules/shortcuts/Publish to BrewPage.unsigned.shortcut" signed.shortcut
python3 -I modules/shortcuts/inspect_signed.py signed.shortcut \
  --unsigned "modules/shortcuts/Publish to BrewPage.unsigned.shortcut" --compare other-signed.shortcut
python3 -I modules/shortcuts/test_inspect_signed.py
```

`sign.sh` needs a Mac signed in to iCloud. `inspect_signed.py` exits 0 (PASS), 1 (FAIL) or 2 (unreadable) and
prints certificate values only when they are Apple's constants; any other value is shown as its field name, as in
`CN present (32 chars)`. It fails on:

- Apple ID fields (`AppleIDCertificateChain`, `AppleIDValidationRecord`) or any auth-data key other than
  `SigningCertificateChain`;
- `@`, a phone-like digit run, a person-like name or a personal attribute in a certificate subject, issuer,
  subject alternative name or extension;
- an iCloud share record id or another opaque identifier in the signer certificate subject;
- with `--compare`: a signer certificate field that is the same in signatures of two different shortcuts;
- with `--unsigned`: a payload that differs from the unsigned build as a parsed property list (the payload
  signature is checked with the macOS `aea` tool against the signing key).

**Why a signed file is not published yet.** In every public iCloud-signed file (auth data `SigningCertificateChain`
only) checked on 2026-11-20 (13 files, 6 authors, including the libshortcutsign test file), the signer
certificate's CN is the shortcut's iCloud share record id. A local `sign.sh` run has not been inspected yet. The public record API, `https://www.icloud.com/shortcuts/api/records/<id>`, returns
`created.userRecordName` and `created.deviceID` for that record; `userRecordName` was the same in all 8 files of
one author and different for each other author. The file itself names nobody, but it links to a stable account
identifier, so it is signed only from a dedicated publisher Apple Account; `--allow-icloud-record` accepts the
record id for that case.

## Not verified yet

Signing this shortcut, the content of its signed file, and runs on iPhone, iPad and Mac (permission prompts,
Cancel uploading nothing) need an Apple Account and a device.

## License

Apache-2.0, as the rest of this repository.
