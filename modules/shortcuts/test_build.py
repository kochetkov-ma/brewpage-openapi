#!/usr/bin/env python3
"""Checks build.py: byte-identical output and the flow rules of the Publish to BrewPage shortcut."""

import importlib.util
import plistlib
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # keep the module folder free of __pycache__
HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("shortcut_build", HERE / "build.py")
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)

DATA, MARKDOWN = build.render()
SHORTCUT = plistlib.loads(DATA)
ACTIONS = SHORTCUT["WFWorkflowActions"]
IDS = [action["WFWorkflowActionIdentifier"] for action in ACTIONS]
PARAMS = [action["WFWorkflowActionParameters"] for action in ACTIONS]
INDEX_BY_UUID = {params["UUID"]: index for index, params in enumerate(PARAMS)}
ALLOWED_ACTIONS = {
    f"is.workflow.actions.{name}"
    for name in (
        "alert", "choosefrommenu", "comment", "conditional", "count", "dictionary", "downloadurl", "exit", "getitemtype",
        "getrichtextfrommarkdown", "gettext", "getvalueforkey", "math", "openurl", "properties.files", "setclipboard",
        "setvariable", "showresult",
    )
}


def ref_name(ref):
    names = {"ExtensionInput": "Shortcut Input", "Variable": ref.get("VariableName"), "ActionOutput": ref.get("OutputName")}
    return "{" + names[ref["Type"]] + "}"


def flat(value):
    """Text of a parameter with each variable shown as {name}."""
    if isinstance(value, str):
        return value
    if value["WFSerializationType"] == "WFTextTokenAttachment":
        return ref_name(value["Value"])
    units = value["Value"]["string"].encode("utf-16-le")
    attachments = value["Value"].get("attachmentsByRange", {})
    for key in sorted(attachments, key=lambda k: -int(k[1:].split(",")[0])):
        at = int(key[1:].split(",")[0]) * 2
        units = units[:at] + ref_name(attachments[key]).encode("utf-16-le") + units[at + 2:]
    return units.decode("utf-16-le")


def headers(params):
    items = params["WFHTTPHeaders"]["Value"]["WFDictionaryFieldValueItems"]
    return {flat(item["WFKey"]): flat(item["WFValue"]) for item in items}


def body(params):
    """Body type and (field, item type) pairs of a request; item type 5 is a file."""
    kind = params.get("WFHTTPBodyType")
    values = params.get({"JSON": "WFJSONValues", "Form": "WFFormValues"}.get(kind, ""), {"Value": {}})
    items = values["Value"].get("WFDictionaryFieldValueItems", [])
    return kind, sorted((flat(item["WFKey"]), item["WFItemType"]) for item in items)


def milestones():
    """User-visible and network steps in run order."""
    steps = []
    for identifier, params in zip(IDS, PARAMS):
        name = identifier.rsplit(".", 1)[1]
        if name == "downloadurl":
            steps.append((params["WFHTTPMethod"], flat(params["WFURL"])))
        elif name == "alert":
            steps.append(("alert", params["WFAlertActionTitle"]))
        elif name == "choosefrommenu" and params["WFControlFlowMode"] == 0:
            steps.append(("menu", tuple(params["WFMenuItems"])))
        elif name in ("exit", "setclipboard", "openurl", "showresult"):
            steps.append((name,))
    return steps


def strings(node):
    if isinstance(node, dict):
        return [s for key, value in node.items() for s in [key, *strings(value)]]
    if isinstance(node, list):
        return [s for value in node for s in strings(value)]
    return [node] if isinstance(node, str) else []


def output_users(index):
    """Identifiers of the actions that read the output of action `index`."""
    uuid = PARAMS[index]["UUID"]
    return sorted({IDS[i] for i, params in enumerate(PARAMS) if i != index and uuid in strings(params)})


class BuildTest(unittest.TestCase):
    def test_given_source_when_rendered_again_then_bytes_match_render_and_committed_files(self):
        committed = (build.SHORTCUT_PATH.read_bytes(), build.ACTIONS_PATH.read_bytes())
        self.assertEqual((DATA, MARKDOWN), build.render(), "two renders of the same source must be byte-identical")
        self.assertEqual((DATA, MARKDOWN), committed, "committed files must equal a fresh build; run build.py")

    def test_given_shortcut_when_read_then_top_level_keys_are_the_exported_set(self):
        top = {key: value for key, value in SHORTCUT.items() if key != "WFWorkflowActions"}
        expected = {
            "WFQuickActionSurfaces": ["Finder", "Services"],
            "WFWorkflowClientVersion": "5114.0.6.204",
            "WFWorkflowHasOutputFallback": False,
            "WFWorkflowHasShortcutInputVariables": True,
            "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440, "WFWorkflowIconStartColor": 463140863},
            "WFWorkflowImportQuestions": [],
            "WFWorkflowInputContentItemClasses": [
                "WFStringContentItem", "WFRichTextContentItem", "WFGenericFileContentItem", "WFPDFContentItem",
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
        self.assertEqual(top, expected, "top-level keys: share sheet + Quick Action, text/file input, ask for text")

    def test_given_shortcut_when_run_then_visible_and_network_steps_follow_the_design(self):
        expected = [
            ("alert", "One item at a time"),
            ("exit",),
            ("GET", "https://brewpage.app/api/limits"),
            ("menu", ("Markdown", "Plain text", "HTML")),
            ("alert", "BrewPage is not reachable"),
            ("exit",),
            ("alert", "Too large for BrewPage"),
            ("exit",),
            ("menu", ("Unlisted", "Public")),
            ("menu", ("15 days", "1 day", "7 days", "Maximum allowed")),
            ("alert", "Publish to brewpage.app?"),
            ("POST", "https://brewpage.app/api/html{Query}{Days}"),
            ("POST", "https://brewpage.app/api/files{Query}{Days}"),
            ("setclipboard",),
            ("menu", ("Open", "Show private management link", "Done")),
            ("openurl",),
            ("showresult",),
            ("showresult",),
            ("alert", "Not published"),
            ("alert", "Not published"),
        ]
        self.assertEqual(milestones(), expected, "defaults first, one confirm alert, uploads only after it")

    def test_given_shortcut_when_inspected_then_safety_rules_hold(self):
        requests = [i for i, identifier in enumerate(IDS) if identifier.endswith("downloadurl")]
        first_if = IDS.index("is.workflow.actions.conditional")
        counted = INDEX_BY_UUID[PARAMS[first_if]["WFInput"]["Variable"]["Value"]["OutputUUID"]]
        confirm = next(i for i, p in enumerate(PARAMS) if p.get("WFAlertActionTitle") == "Publish to brewpage.app?")
        group = next(p for p in PARAMS if p.get("WFMenuItems") == ["Unlisted", "Public"])["GroupingIdentifier"]
        in_group = [i for i, p in enumerate(PARAMS) if p.get("GroupingIdentifier") == group]
        public_case = next(i for i in in_group if PARAMS[i].get("WFMenuItemTitle") == "Public")
        ns_public = [i for i, params in enumerate(PARAMS) if any("ns=public" in s for s in strings(params))]
        copies = [i for i, identifier in enumerate(IDS) if identifier.endswith("setclipboard")]
        copied = [(PARAMS[INDEX_BY_UUID[PARAMS[i]["WFInput"]["Value"]["OutputUUID"]]]["WFDictionaryKey"],
                   PARAMS[i]["WFLocalOnly"]) for i in copies]
        manage = next(i for i, p in enumerate(PARAMS) if p.get("WFDictionaryKey") == "manageUrl")
        confirm_message = (
            "Access: {Access}\nRetention: {Days} days\nSize limit: {LimitMB} MB\n\n"
            "The item is uploaded to brewpage.app only if you continue."
        )
        rows = [
            ("more than one item stops the run",
             (IDS[counted], PARAMS[first_if]["WFCondition"], PARAMS[first_if]["WFNumberValue"]),
             ("is.workflow.actions.count", 2, "1")),
            ("client header on all 3 requests",
             [headers(PARAMS[i]) for i in requests], [{"X-BrewPage-Client": "shortcuts/1"}] * 3),
            ("only the limits read precedes the confirm alert",
             [(i < confirm, PARAMS[i]["WFHTTPMethod"]) for i in requests],
             [(True, "GET"), (False, "POST"), (False, "POST")]),
            ("confirm alert names site, access, retention, size and has Cancel",
             (flat(PARAMS[confirm]["WFAlertActionMessage"]), PARAMS[confirm]["WFAlertActionCancelButtonShown"]),
             (confirm_message, True)),
            ("text goes as JSON content and format, a file as form field file",
             [body(PARAMS[i]) for i in requests],
             [(None, []), ("JSON", [("content", 0), ("format", 0)]), ("Form", [("file", 5)])]),
            ("ns=public only on the Public path", [public_case < i < in_group[-1] for i in ns_public], [True]),
            ("no owner token read or sent", [s for s in strings(SHORTCUT) if "ownerToken" in s or "Owner-Token" in s], []),
            ("only reading and display actions, nothing saved", sorted(set(IDS) - ALLOWED_ACTIONS), []),
            ("only the link is copied, Local Only", copied, [("link", True)]),
            ("management link is only shown", output_users(manage),
             ["is.workflow.actions.conditional", "is.workflow.actions.showresult"]),
        ]
        for rule, actual, expected in rows:
            with self.subTest(rule=rule):
                self.assertEqual(actual, expected, rule)


if __name__ == "__main__":
    unittest.main(verbosity=2)
