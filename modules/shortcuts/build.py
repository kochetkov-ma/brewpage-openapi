#!/usr/bin/env python3
"""Builds the unsigned "Publish to BrewPage" Apple Shortcut and ACTIONS.md from this one file.
Stdlib only; sorted keys and name-derived UUIDs make every rebuild byte-identical."""

import plistlib
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = "Publish to BrewPage"
SHORTCUT_PATH = HERE / f"{NAME}.unsigned.shortcut"
ACTIONS_PATH = HERE / "ACTIONS.md"
SOURCE_URL = "https://github.com/kochetkov-ma/brewpage-openapi/tree/main/modules/shortcuts"
API = "https://brewpage.app"
CLIENT_HEADER = ("X-BrewPage-Client", "shortcuts/1")
UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://brewpage.app/shortcuts/publish-to-brewpage")
MIB = 1048576
OBJECT_REPLACEMENT = chr(0xFFFC)
OBSERVED_ON = "macOS 27.2.1 (26B131), Shortcuts 10.0 (5114.0.6.204)"

# Same extension -> cap mapping as the server's video/audio size caps; anything else uses maxFileBytes.
MEDIA_LIMIT_KEYS = {
    **{ext: "maxVideoBytes" for ext in ("mp4", "webm", "mov", "mkv", "avi")},
    **{ext: "maxAudioBytes" for ext in ("mp3", "ogg", "wav", "m4a", "aac", "flac", "opus", "weba")},
}

# Condition codes of the If action ("WFCondition"), as Shortcuts writes them.
CONDITIONS = {
    "is less than": 0, "is greater than": 2, "is": 4, "contains": 99, "has any value": 100, "does not have any value": 101,
}

# Where each action identifier and its parameter keys were observed; ACTIONS.md prints one line each.
DEFINITIONS = "WorkflowKit action registry definition (`WFActionRegistry createActionWithIdentifier:`)"
SUMMARY = "parameter summary string in the system Shortcuts frameworks"
SOURCES = {
    "is.workflow.actions.comment": f"{DEFINITIONS}: class WFCommentAction, key WFCommentActionText",
    "is.workflow.actions.count": f'{SUMMARY} "Count ${{WFCountType}} in ${{Input}}", item "Items (WFCountType)"',
    "is.workflow.actions.conditional": f"{DEFINITIONS}: class WFConditionalAction reads WFInput, WFCondition, "
    "WFConditionalActionString and WFNumberValue into its WFConditions table; codes 0, 2, 4, 99, 100, 101 decode to is "
    "less than, is greater than, is, contains, has any value, does not have any value",
    "is.workflow.actions.alert": f'{SUMMARY} "Show alert ${{WFAlertActionMessage}}", items "Title (WFAlertActionTitle)", '
    '"Show Cancel Button (WFAlertActionCancelButtonShown)"',
    "is.workflow.actions.exit": f"{DEFINITIONS}: class WFExitAction (Stop This Shortcut), optional key WFResult",
    "is.workflow.actions.downloadurl": f"{DEFINITIONS}: class WFDownloadURLAction, keys WFURL, WFHTTPMethod, "
    "ShowHeaders, WFHTTPHeaders, WFHTTPBodyType (JSON/Form/File), WFJSONValues (item types 0-4), WFFormValues (0, 5 = file)",
    "is.workflow.actions.gettext": f"{DEFINITIONS}: class WFTextAction, key WFTextActionText",
    "is.workflow.actions.getitemtype": f"{DEFINITIONS}: class WFGetItemTypeAction (Get Type), key WFInput",
    "is.workflow.actions.getrichtextfrommarkdown": f"{DEFINITIONS}: class WFRichTextFromMarkdownAction, key WFInput",
    "is.workflow.actions.choosefrommenu": f"{DEFINITIONS}: class WFChooseFromMenuAction, keys WFMenuPrompt, WFMenuItems",
    "is.workflow.actions.setvariable": f"{DEFINITIONS}: class WFSetVariableAction, keys WFVariableName, WFInput",
    "is.workflow.actions.dictionary": f"{DEFINITIONS}: class WFDictionaryAction, key WFItems",
    "is.workflow.actions.getvalueforkey": f'{SUMMARY} "Get ${{WFGetDictionaryValueType}} for ${{WFDictionaryKey}} in '
    '${WFInput}", item "Value (WFGetDictionaryValueType)"',
    "is.workflow.actions.properties.files": f"{DEFINITIONS}: class WFContentItemPropertiesAction over "
    "WFGenericFileContentItem; property names from `+[WFGenericFileContentItem allProperties]`",
    "is.workflow.actions.math": f"{DEFINITIONS}: class WFCalculateAction, keys WFInput, WFMathOperation (+ - × ÷), WFMathOperand",
    "is.workflow.actions.setclipboard": f'{SUMMARY} "Copy ${{WFInput}} to clipboard", item "Local Only (WFLocalOnly)"',
    "is.workflow.actions.openurl": f"{DEFINITIONS}: class WFOpenURLAction, key WFInput",
    "is.workflow.actions.showresult": f"{DEFINITIONS}: class WFShowResultAction, key Text",
}


class Var:
    """A variable reference; `label` is how ACTIONS.md names it."""

    def __init__(self, ref, label):
        self.ref = ref
        self.label = label

    def attachment(self):
        return {"Value": dict(self.ref), "WFSerializationType": "WFTextTokenAttachment"}


SHORTCUT_INPUT = Var({"Type": "ExtensionInput"}, "Shortcut Input")


def named(name):
    return Var({"Type": "Variable", "VariableName": name}, name)


def token_string(parts):
    text, attachments = "", {}
    for part in parts:
        if isinstance(part, Var):
            attachments[f"{{{len(text.encode('utf-16-le')) // 2}, 1}}"] = dict(part.ref)
            text += OBJECT_REPLACEMENT
        else:
            text += part
    value = {"attachmentsByRange": attachments, "string": text} if attachments else {"string": text}
    return {"Value": value, "WFSerializationType": "WFTextTokenString"}


def text_param(parts):
    """Plain string when no variable is inside, as exports write it; else a token string."""
    return "".join(parts) if all(isinstance(p, str) for p in parts) else token_string(parts)


def shown(parts):
    return "".join(f"{{{p.label}}}" if isinstance(p, Var) else p for p in parts).replace("\n", "<br>")


def fields(items):
    """WFDictionaryFieldValue from (key, value parts, item type); a type 5 (File) value wraps one variable."""
    out = []
    for key, value, item_type in items:
        if item_type == 5:
            wf_value = {"Value": value.attachment(), "WFSerializationType": "WFTokenAttachmentParameterState"}
        else:
            wf_value = token_string(value)
        out.append({"WFItemType": item_type, "WFKey": token_string([key]), "WFValue": wf_value})
    return {"Value": {"WFDictionaryFieldValueItems": out}, "WFSerializationType": "WFDictionaryFieldValue"}


class Flow:
    """Collects actions in order plus one ACTIONS.md row per action."""

    def __init__(self):
        self.actions = []
        self.rows = []
        self.labels = set()
        self.depth = 0
        self.groups = []

    def _uuid(self, label):
        assert label not in self.labels, f"duplicate action label {label}"
        self.labels.add(label)
        return str(uuid.uuid5(UUID_NAMESPACE, label)).upper()

    def add(self, identifier, label, params, describe, output=None):
        action_uuid = self._uuid(label)
        self.actions.append(
            {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": {**params, "UUID": action_uuid}}
        )
        self.rows.append((self.depth, describe, identifier))
        if output is None:
            return None
        step = len(self.actions)
        return Var({"Type": "ActionOutput", "OutputName": output, "OutputUUID": action_uuid}, f"{output} of step {step}")

    def comment(self, label, text):
        self.add("is.workflow.actions.comment", label, {"WFCommentActionText": text}, f"Comment: {text}")

    def count(self, label, var):
        return self.add(
            "is.workflow.actions.count",
            label,
            {"Input": var.attachment(), "WFCountType": "Items"},
            f"Count items in {{{var.label}}}",
            "Count",
        )

    def if_(self, label, var, condition, value=None):
        group = self._uuid(f"{label}/group")
        params = {
            "GroupingIdentifier": group,
            "WFCondition": CONDITIONS[condition],
            "WFControlFlowMode": 0,
            "WFInput": {"Type": "Variable", "Variable": var.attachment()},
        }
        if isinstance(value, int):
            params["WFNumberValue"] = str(value)
        elif value is not None:
            params["WFConditionalActionString"] = text_param(value)
        right = "" if value is None else f" {value}" if isinstance(value, int) else f' "{shown(value)}"'
        self.add("is.workflow.actions.conditional", label, params, f"If {{{var.label}}} {condition}{right}")
        self.groups.append((label, group, "is.workflow.actions.conditional"))
        self.depth += 1

    def otherwise(self):
        label, group, identifier = self.groups[-1]
        self.depth -= 1
        self.add(identifier, f"{label}/otherwise", {"GroupingIdentifier": group, "WFControlFlowMode": 1}, "Otherwise")
        self.depth += 1

    def end(self, output):
        label, group, identifier = self.groups.pop()
        self.depth -= 1
        name = "End If" if identifier.endswith("conditional") else "End Menu"
        return self.add(identifier, f"{label}/end", {"GroupingIdentifier": group, "WFControlFlowMode": 2}, name, output)

    def menu(self, label, prompt, items):
        group = self._uuid(f"{label}/group")
        params = {
            "GroupingIdentifier": group,
            "WFControlFlowMode": 0,
            "WFMenuItems": items,
            "WFMenuPrompt": text_param(prompt),
        }
        listed = ", ".join(f'"{item}"' for item in items)
        self.add("is.workflow.actions.choosefrommenu", label, params, f'Choose from menu "{shown(prompt)}": {listed}')
        self.groups.append((label, group, "is.workflow.actions.choosefrommenu"))
        self.depth += 1

    def case(self, title):
        label, group, identifier = self.groups[-1]
        self.depth -= 1
        params = {"GroupingIdentifier": group, "WFControlFlowMode": 1, "WFMenuItemTitle": title}
        self.add(identifier, f"{label}/case/{title}", params, f'Case "{title}"')
        self.depth += 1

    def alert(self, label, title, message, cancel):
        params = {
            "WFAlertActionCancelButtonShown": cancel,
            "WFAlertActionMessage": text_param(message),
            "WFAlertActionTitle": title,
        }
        buttons = "OK and Cancel" if cancel else "OK only"
        self.add("is.workflow.actions.alert", label, params, f'Show alert "{title}": "{shown(message)}" ({buttons})')

    def stop(self, label):
        self.add("is.workflow.actions.exit", label, {}, "Stop this shortcut")

    def get_url(self, label, url, method, json=None, form=None):
        params = {
            "ShowHeaders": True,
            "WFHTTPHeaders": fields([(CLIENT_HEADER[0], [CLIENT_HEADER[1]], 0)]),
            "WFHTTPMethod": method,
            "WFURL": text_param(url),
        }
        body = ""
        if json is not None:
            params.update({"WFHTTPBodyType": "JSON", "WFJSONValues": fields([(k, v, 0) for k, v in json])})
            body = " with JSON body " + ", ".join(f"{k} = {shown(v)}" for k, v in json)
        if form is not None:
            params.update({"WFHTTPBodyType": "Form", "WFFormValues": fields([(k, v, 5) for k, v in form])})
            body = " with form body " + ", ".join(f"{k} = file {{{v.label}}}" for k, v in form)
        header = f"{CLIENT_HEADER[0]}: {CLIENT_HEADER[1]}"
        describe = f"Get contents of URL: {method} {shown(url)}{body}; header {header}"
        return self.add("is.workflow.actions.downloadurl", label, params, describe, "Contents of URL")

    def text(self, label, parts):
        params = {"WFTextActionText": text_param(parts)}
        return self.add("is.workflow.actions.gettext", label, params, f'Text "{shown(parts)}"', "Text")

    def get_type(self, label, var):
        params = {"WFInput": var.attachment()}
        return self.add("is.workflow.actions.getitemtype", label, params, f"Get type of {{{var.label}}}", "Type")

    def rich_text(self, label, var):
        params = {"WFInput": var.attachment()}
        describe = f"Make rich text from Markdown {{{var.label}}}"
        return self.add("is.workflow.actions.getrichtextfrommarkdown", label, params, describe, "Rich Text from Markdown")

    def set_var(self, label, name, var):
        params = {"WFInput": var.attachment(), "WFVariableName": name}
        self.add("is.workflow.actions.setvariable", label, params, f"Set variable {name} to {{{var.label}}}")
        return named(name)

    def dictionary(self, label, pairs):
        params = {"WFItems": fields([(k, [v], 0) for k, v in pairs])}
        listed = ", ".join(f"{k}: {v}" for k, v in pairs)
        return self.add("is.workflow.actions.dictionary", label, params, f"Dictionary {{{listed}}}", "Dictionary")

    def get_value(self, label, var, key):
        params = {"WFDictionaryKey": text_param(key), "WFGetDictionaryValueType": "Value", "WFInput": var.attachment()}
        describe = f'Get value for key "{shown(key)}" in {{{var.label}}}'
        return self.add("is.workflow.actions.getvalueforkey", label, params, describe, "Dictionary Value")

    def file_property(self, label, var, prop):
        params = {"WFContentItemPropertyName": prop, "WFInput": var.attachment()}
        return self.add("is.workflow.actions.properties.files", label, params, f"Get {prop} of {{{var.label}}}", prop)

    def calc(self, label, left, operation, right):
        params = {
            "WFInput": left.attachment(),
            "WFMathOperand": right.attachment() if isinstance(right, Var) else right,
            "WFMathOperation": operation,
        }
        operand = f"{{{right.label}}}" if isinstance(right, Var) else str(right)
        describe = f"Calculate {{{left.label}}} {operation} {operand}"
        return self.add("is.workflow.actions.math", label, params, describe, "Calculation Result")

    def copy(self, label, var):
        params = {"WFInput": var.attachment(), "WFLocalOnly": True}
        self.add("is.workflow.actions.setclipboard", label, params, f"Copy {{{var.label}}} to clipboard, Local Only on")

    def open_url(self, label, var):
        self.add("is.workflow.actions.openurl", label, {"WFInput": var.attachment()}, f"Open {{{var.label}}}")

    def show(self, label, parts):
        self.add("is.workflow.actions.showresult", label, {"Text": text_param(parts)}, f'Show result "{shown(parts)}"')


def build_flow():
    f = Flow()
    about = f"{NAME} ({CLIENT_HEADER[1]}). Source and action list: {SOURCE_URL}. Nothing is uploaded before you confirm."
    f.comment("about", about)

    count = f.count("count", SHORTCUT_INPUT)
    f.if_("one-item", count, "is greater than", 1)
    f.alert("one-item/alert", "One item at a time", ["Share a single text or file with Publish to BrewPage."], False)
    f.stop("one-item/stop")
    f.end(None)

    limits = f.get_url("limits", [f"{API}/api/limits"], "GET")

    # Get Type names are localized, so the input's type is compared with types made on the same device.
    sample = f.text("kind/sample", ["BrewPage"])
    text_type = f.get_type("kind/text-type", sample)
    rich_type = f.get_type("kind/rich-type", f.rich_text("kind/rich-sample", sample))
    input_type = f.get_type("kind/input-type", SHORTCUT_INPUT)
    text_types = f.text("kind/text-types", ["|", text_type, "|", rich_type, "|"])
    marker = f.text("kind/marker", ["|", input_type, "|"])
    f.if_("kind", text_types, "contains", [marker])
    f.menu("format", ["Publish the text as"], ["Markdown", "Plain text", "HTML"])
    f.case("Markdown")
    f.text("format/markdown", ["markdown"])
    f.case("Plain text")
    f.text("format/txt", ["txt"])
    f.case("HTML")
    f.text("format/html", ["html"])
    fmt = f.set_var("format/set", "Format", f.end("Menu Result"))
    f.set_var("kind/text/section", "Section", f.text("kind/text/section-name", ["html"]))
    f.set_var("kind/text/limit-key", "LimitKey", f.text("kind/text/limit-key-name", ["maxBytes"]))
    f.otherwise()
    media = f.dictionary("kind/media", [(k, v) for ext, v in MEDIA_LIMIT_KEYS.items() for k in (ext, ext.upper())])
    extension = f.file_property("kind/extension", SHORTCUT_INPUT, "File Extension")
    media_key = f.get_value("kind/media-key", media, [extension])
    f.if_("kind/media-known", media_key, "has any value")
    f.text("kind/media-limit", [media_key])
    f.otherwise()
    f.text("kind/file-limit", ["maxFileBytes"])
    f.set_var("kind/file/limit-key", "LimitKey", f.end("If Result"))
    f.set_var("kind/file/section", "Section", f.text("kind/file/section-name", ["files"]))
    f.end(None)

    section = f.get_value("limits/section", limits, [named("Section")])
    limit = f.set_var("limits/bytes", "LimitBytes", f.get_value("limits/bytes-value", section, [named("LimitKey")]))
    f.if_("limits/missing", limit, "does not have any value")
    f.alert("limits/alert", "BrewPage is not reachable", ["Could not read the upload limits. Try again later."], False)
    f.stop("limits/stop")
    f.end(None)
    max_days = f.set_var("limits/max-days", "MaxDays", f.get_value("limits/max-days-value", section, ["maxTtlDays"]))
    limit_mb = f.set_var("limits/mb", "LimitMB", f.calc("limits/mb-value", limit, "÷", MIB))
    size = f.file_property("size", SHORTCUT_INPUT, "File Size")
    headroom = f.calc("size/headroom", limit, "-", size)
    f.if_("size/too-large", headroom, "is less than", 0)
    f.alert("size/alert", "Too large for BrewPage", ["This item is over the ", limit_mb, " MB limit for its kind."], False)
    f.stop("size/stop")
    f.end(None)

    f.menu("access", ["Who can open it?"], ["Unlisted", "Public"])
    f.case("Unlisted")
    f.set_var("access/unlisted", "Access", f.text("access/unlisted-label", ["Unlisted: only people with the link"]))
    f.text("access/unlisted-query", ["?ttl="])
    f.case("Public")
    f.set_var("access/public", "Access", f.text("access/public-label", ["Public: listed in the gallery and search"]))
    f.text("access/public-query", ["?ns=public&ttl="])
    query = f.set_var("access/query", "Query", f.end("Menu Result"))

    f.menu("retention", ["How long should it stay online?"], ["15 days", "1 day", "7 days", "Maximum allowed"])
    for days in ("15", "1", "7"):
        f.case(f"{days} day" + ("" if days == "1" else "s"))
        f.text(f"retention/{days}", [days])
    f.case("Maximum allowed")
    f.text("retention/max", [max_days])
    days = f.set_var("retention/days", "Days", f.end("Menu Result"))

    f.alert(
        "confirm",
        "Publish to brewpage.app?",
        [
            "Access: ", named("Access"), "\nRetention: ", days, " days\nSize limit: ", limit_mb,
            " MB\n\nThe item is uploaded to brewpage.app only if you continue.",
        ],
        True,
    )

    f.if_("upload/kind", named("Section"), "is", ["html"])
    html = f.get_url(
        "upload/html", [f"{API}/api/html", query, days], "POST", json=[("content", [SHORTCUT_INPUT]), ("format", [fmt])]
    )
    f.set_var("upload/html/response", "Response", html)
    f.otherwise()
    file = f.get_url("upload/file", [f"{API}/api/files", query, days], "POST", form=[("file", SHORTCUT_INPUT)])
    f.set_var("upload/file/response", "Response", file)
    f.end(None)

    response = named("Response")
    link = f.get_value("result/link", response, ["link"])
    f.if_("result/published", link, "has any value")
    f.copy("result/copy", link)
    expires = f.get_value("result/expires", response, ["expiresAt"])
    f.menu(
        "result/menu",
        ["Published. The link is copied to this device.\n", link, "\nOnline until ", expires],
        ["Open", "Show private management link", "Done"],
    )
    f.case("Open")
    f.open_url("result/open", link)
    f.case("Show private management link")
    manage = f.get_value("result/manage", response, ["manageUrl"])
    f.if_("result/manage-known", manage, "has any value")
    warning = "Private management link: anyone who has it can change or delete this publication. Keep it to yourself."
    f.show("result/manage-show", [warning, "\n\n", manage])
    f.otherwise()
    f.show("result/manage-none", ["No new management link was issued for this upload."])
    f.end(None)
    f.case("Done")
    f.end(None)
    f.otherwise()
    message = f.get_value("result/message", response, ["message"])
    retry = f.get_value("result/retry", response, ["retryAfterSeconds"])
    f.if_("result/retry-known", retry, "has any value")
    f.alert("result/retry-alert", "Not published", [message, "\nTry again in ", retry, " seconds."], False)
    f.otherwise()
    f.alert("result/failed-alert", "Not published", ["BrewPage did not return a link. ", message], False)
    f.end(None)
    f.end(None)
    assert not f.groups and f.depth == 0, "unbalanced control flow"
    return f


def shortcut(flow):
    return {
        "WFQuickActionSurfaces": ["Finder", "Services"],
        "WFWorkflowActions": flow.actions,
        "WFWorkflowClientVersion": "5114.0.6.204",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440, "WFWorkflowIconStartColor": 463140863},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFStringContentItem",
            "WFRichTextContentItem",
            "WFGenericFileContentItem",
            "WFPDFContentItem",
            "WFImageContentItem",
        ],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowNoInputBehavior": {
            "Name": "WFWorkflowNoInputBehaviorAskForInput",
            "Parameters": {"ItemClass": "WFStringContentItem"},
        },
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension", "QuickActions"],
    }


def actions_markdown(flow, top):
    lines = [
        f"# {NAME}: action list",
        "",
        "Generated by `build.py`; do not edit. Rebuild with `python3 -I modules/shortcuts/build.py`.",
        "",
        "Variables are shown as `{Name}`; `{X of step N}` is the output of step N.",
        "",
        "| # | Step | Identifier |",
        "|---|---|---|",
    ]
    for number, (depth, describe, identifier) in enumerate(flow.rows, 1):
        cell = ("· " * depth + describe).replace("|", "\\|")
        lines.append(f"| {number} | {cell} | `{identifier}` |")
    lines += ["", "## Top-level keys", "", "| Key | Value |", "|---|---|"]
    for key, value in sorted(top.items()):
        cell = f"{len(flow.actions)} actions" if key == "WFWorkflowActions" else f"`{value!r}`"
        lines.append(f"| `{key}` | {cell} |")
    lines += [
        "",
        "## Where each identifier comes from",
        "",
        f"Observed on {OBSERVED_ON}. Method: README.md, section Provenance.",
        "",
    ]
    used = sorted({identifier for _, _, identifier in flow.rows})
    lines += [f"- `{identifier}`: {SOURCES[identifier]}" for identifier in used]
    return "\n".join(lines) + "\n"


def render():
    flow = build_flow()
    top = shortcut(flow)
    data = plistlib.dumps(top, fmt=plistlib.FMT_BINARY, sort_keys=True)
    return data, actions_markdown(flow, top).encode("utf-8")


def main():
    data, markdown = render()
    SHORTCUT_PATH.write_bytes(data)
    ACTIONS_PATH.write_bytes(markdown)


if __name__ == "__main__":
    main()
