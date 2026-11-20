#!/usr/bin/env python3
"""Checks a signed .shortcut (AEA1) for anything that identifies the signer before it is published.
Usage: inspect_signed.py SIGNED [--unsigned UNSIGNED] [--compare OTHER_SIGNED]; exit 0 PASS, 1 FAIL, 2 unreadable."""

import argparse
import plistlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

MAGIC = b"AEA1"
SIGNED_PROFILE = 0  # hkdf_sha256_hmac__none__ecdsa_p256: signed, not encrypted
ALLOWED_KEYS = {"SigningCertificateChain"}
APPLE_ID_KEYS = {"AppleIDCertificateChain", "AppleIDValidationRecord"}
ATTRIBUTES = {
    "2.5.4.3": "CN", "2.5.4.4": "SN", "2.5.4.5": "serialNumber", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST",
    "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.41": "name", "2.5.4.42": "GN", "2.5.4.43": "initials",
    "2.5.4.44": "generationQualifier", "2.5.4.45": "uniqueIdentifier", "2.5.4.65": "pseudonym",
    "0.9.2342.19200300.100.1.1": "UID", "1.2.840.113549.1.9.1": "emailAddress",
}
PUBLIC_VALUES = {"Apple Inc.", "Apple Certification Authority"}
PERSON_ATTRIBUTES = {"SN", "GN", "initials", "name", "generationQualifier", "pseudonym"}
IDENTIFIER_ATTRIBUTES = {"serialNumber", "uniqueIdentifier", "UID"}
SAN_KINDS = {0x80: "otherName", 0x81: "email", 0x82: "dns", 0x86: "uri", 0x87: "ip", 0x88: "registeredID"}
# Extensions that describe the issuer or policy, the same for every signer.
POLICY_EXTENSIONS = {
    "2.5.29.15", "2.5.29.19", "2.5.29.31", "2.5.29.32", "2.5.29.35", "2.5.29.37", "1.3.6.1.5.5.7.1.1",
}
STRING_TAGS = {0x0C: "utf-8", 0x12: "ascii", 0x13: "ascii", 0x14: "latin-1", 0x16: "ascii", 0x1A: "ascii",
               0x1C: "utf-32-be", 0x1E: "utf-16-be"}
ORG_WORDS = {
    "apple", "inc", "inc.", "ca", "root", "authority", "certification", "application", "integration", "worldwide",
    "developer", "relations", "shortcuts", "shortcut", "signing", "sharing", "services", "service", "server",
    "intermediate", "sub", "public", "ecc", "rsa", "corporation", "corp", "llc", "ltd", "test", "example", "icloud",
}
PHONE = re.compile(r"(?<!\d)\+?\d(?:[\s().-]?\d){6,14}(?!\d)")
OPAQUE = re.compile(r"[0-9A-Fa-f-]{8,}|\d{6,}|[A-Za-z0-9+/=_-]{16,}")
# Leaf CN of iCloud-signed files = share record id; its public record names the signer's userRecordName.
RECORD_ID = re.compile(r"[0-9a-f]{32}")


class Unreadable(Exception):
    pass


def der(data, pos):
    """One DER element at pos -> (tag, content start, content end)."""
    if pos + 2 > len(data) or data[pos] & 0x1F == 0x1F:
        raise Unreadable("bad DER element")
    tag, length, pos = data[pos], data[pos + 1], pos + 2
    if length & 0x80:
        count = length & 0x7F
        if not 0 < count <= 4:
            raise Unreadable("bad DER length")
        length, pos = int.from_bytes(data[pos:pos + count], "big"), pos + count
    if pos + length > len(data):
        raise Unreadable("truncated DER")
    return tag, pos, pos + length


def children(data, start, end):
    items, pos = [], start
    while pos < end:
        tag, child_start, child_end = der(data, pos)
        items.append((tag, child_start, child_end))
        pos = child_end
    return items


def oid(raw):
    head = min(raw[0] // 40, 2)
    parts, value = [head, raw[0] - 40 * head], 0
    for byte in raw[1:]:
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(value)
            value = 0
    return ".".join(map(str, parts))


def text(tag, raw):
    try:
        return raw.decode(STRING_TAGS[tag])
    except UnicodeDecodeError as error:
        raise Unreadable("bad string in certificate") from error


def texts(data, start, end):
    """Every string inside a DER value, nested DER in OCTET/BIT STRINGs included; printable raw bytes too."""
    found = []
    try:
        items = children(data, start, end)
    except Unreadable:
        raw = data[start:end]
        return [raw.decode("ascii")] if len(raw) >= 3 and all(32 <= b < 127 for b in raw) else []
    for tag, child_start, child_end in items:
        if tag in STRING_TAGS:
            found.append(text(tag, data[child_start:child_end]))
        elif tag in (0x81, 0x82, 0x86):
            found.append(data[child_start:child_end].decode("ascii", "replace"))
        elif tag & 0x20:
            found += texts(data, child_start, child_end)
        elif tag in (0x04, 0x03):
            found += texts(data, child_start + (tag == 0x03), child_end)
    return found


def name(data, start, end):
    """X.509 Name -> [(attribute, value)] in order."""
    pairs = []
    for _, set_start, set_end in children(data, start, end):
        for _, seq_start, seq_end in children(data, set_start, set_end):
            (_, oid_start, oid_end), (tag, value_start, value_end) = children(data, seq_start, seq_end)[:2]
            key = oid(data[oid_start:oid_end])
            value = text(tag, data[value_start:value_end]) if tag in STRING_TAGS else data[value_start:value_end].hex()
            pairs.append((ATTRIBUTES.get(key, key), value))
    return pairs


def certificate(data):
    """DER certificate -> the fields that can name or link a signer."""
    _, cert_start, cert_end = der(data, 0)
    _, tbs_start, tbs_end = children(data, cert_start, cert_end)[0]
    fields = children(data, tbs_start, tbs_end)
    if fields[0][0] == 0xA0:
        fields = fields[1:]
    serial, issuer, subject, spki = fields[0], fields[2], fields[4], fields[5]
    extensions = {}
    for tag, start, end in fields[6:]:
        if tag == 0xA3:
            (_, seq_start, seq_end), = children(data, start, end)
            for _, ext_start, ext_end in children(data, seq_start, seq_end):
                parts = children(data, ext_start, ext_end)
                extensions[oid(data[parts[0][1]:parts[0][2]])] = (parts[-1][1], parts[-1][2])
    san = []
    if "2.5.29.17" in extensions:
        start, end = extensions["2.5.29.17"]
        _, seq_start, seq_end = der(data, start)
        for tag, value_start, value_end in children(data, seq_start, seq_end):
            kind = SAN_KINDS.get(tag, "dirName" if tag == 0xA4 else f"tag{tag:#x}")
            san.append((kind, " ".join(texts(data, value_start, value_end)) if tag & 0x20 else
                        data[value_start:value_end].decode("ascii", "replace")))
    ca = False
    if "2.5.29.19" in extensions:
        start, end = extensions["2.5.29.19"]
        _, seq_start, seq_end = der(data, start)
        ca = any(tag == 0x01 and data[s:e] != b"\x00" for tag, s, e in children(data, seq_start, seq_end))
    _, key_start, key_end = children(data, spki[1], spki[2])[1]
    return {
        "subject": name(data, subject[1], subject[2]),
        "issuer": name(data, issuer[1], issuer[2]),
        "serial": data[serial[1]:serial[2]].hex(),
        "public_key": data[key_start + 1:key_end],
        "ca": ca,
        "san": san,
        "extensions": {key: data[start:end] for key, (start, end) in extensions.items()},
        "extension_texts": {key: texts(data, start, end) for key, (start, end) in extensions.items()
                            if key != "2.5.29.17"},
    }


def read(path):
    """Signed shortcut -> (auth-data dict, certificates); raises Unreadable."""
    data = Path(path).read_bytes()
    if len(data) < 12 or data[:4] != MAGIC:
        raise Unreadable(f"{path}: not an AEA1 container")
    profile = int.from_bytes(data[4:7], "little")
    size = int.from_bytes(data[8:12], "little")
    if profile != SIGNED_PROFILE or 12 + size > len(data):
        raise Unreadable(f"{path}: profile {profile}, auth data {size} bytes: not a signed shortcut")
    try:
        auth = plistlib.loads(data[12:12 + size])
    except Exception as error:
        raise Unreadable(f"{path}: auth data is not a property list") from error
    if not isinstance(auth, dict):
        raise Unreadable(f"{path}: auth data is not a dictionary")
    chain = auth.get("SigningCertificateChain", auth.get("AppleIDCertificateChain", []))
    if not chain or not isinstance(chain, list) or not all(isinstance(item, bytes) for item in chain):
        raise Unreadable(f"{path}: no certificate chain")
    try:
        return auth, [certificate(item) for item in chain]
    except (IndexError, ValueError) as error:
        raise Unreadable(f"{path}: certificate does not parse") from error


def plist_texts(node, path):
    if isinstance(node, dict):
        return [pair for key, value in node.items() for pair in [(path, key), *plist_texts(value, f"{path}.{key}")]]
    if isinstance(node, list):
        return [pair for index, value in enumerate(node) for pair in plist_texts(value, f"{path}[{index}]")]
    return [(path, node)] if isinstance(node, str) else []


def person_like(value):
    words = value.split()
    return 2 <= len(words) <= 4 and all(
        word[0].isupper() and word.replace("-", "").replace("'", "").isalpha() for word in words
    ) and not any(word.lower().strip(".,") in ORG_WORDS for word in words)


def scan(field, value, names=False):
    found = []
    if "@" in value:
        found.append((field, "contains @"))
    if PHONE.search(value):
        found.append((field, "phone-like digit run"))
    if names and person_like(value):
        found.append((field, "person-name-like value"))
    return found


def cert_values(index, cert):
    """(field, value, is name-like) for every text in a certificate."""
    prefix = f"cert[{index}]"
    values = [(f"{prefix}.{part}.{key}", value, True) for part in ("subject", "issuer") for key, value in cert[part]]
    values += [(f"{prefix}.san.{kind}", value, True) for kind, value in cert["san"]]
    values += [(f"{prefix}.ext.{key}", value, False)
               for key, items in cert["extension_texts"].items() for value in items]
    return values


def findings(auth, certs, allow_record=False):
    """[(field, reason)] for everything that may identify the signer in one file."""
    found = []
    for key in sorted(auth):
        if key in APPLE_ID_KEYS or "appleid" in key.lower():
            found.append((f"auth.{key}", "Apple ID field present"))
        elif key not in ALLOWED_KEYS:
            found.append((f"auth.{key}", "unreviewed auth-data key"))
    for field, value in plist_texts(auth, "auth"):
        found += scan(field, value)
    for index, cert in enumerate(certs):
        for field, value, names in cert_values(index, cert):
            signer = not cert["ca"] and (".subject." in field or ".san." in field)
            if signer and RECORD_ID.fullmatch(value):
                if not allow_record:
                    found.append((field, "iCloud share record id: its public record shows the signer's account id"))
                continue
            found += scan(field, value, names)
            if signer and OPAQUE.search(value):
                found.append((field, "opaque identifier in the signer certificate"))
        for key, _ in cert["subject"]:
            if key in PERSON_ATTRIBUTES or key == "emailAddress":
                found.append((f"cert[{index}].subject.{key}", "personal attribute present"))
            elif key in IDENTIFIER_ATTRIBUTES and not cert["ca"]:
                found.append((f"cert[{index}].subject.{key}", "account identifier attribute present"))
        for kind, _ in cert["san"]:
            if kind in ("email", "otherName", "dirName"):
                found.append((f"cert[{index}].san.{kind}", "personal subject alternative name present"))
    return list(dict.fromkeys(found))


def identity(index, cert):
    """Fields of a non-CA certificate that could link signatures to one account."""
    prefix = f"cert[{index}]"
    fields = {f"{prefix}.serial": cert["serial"], f"{prefix}.public_key": cert["public_key"].hex()}
    fields.update({f"{prefix}.subject.{key}": value for key, value in cert["subject"]})
    fields.update({f"{prefix}.san.{kind}": value for kind, value in cert["san"]})
    fields.update({f"{prefix}.ext.{key}": value.hex() for key, value in cert["extensions"].items()
                   if key not in POLICY_EXTENSIONS and value not in (b"", b"\x05\x00")})
    return fields


def stable(one, other):
    """[(field, reason)] for signer fields equal in two signatures of different shortcuts."""
    (_, certs), (_, other_certs) = one, other
    mine = {k: v for i, c in enumerate(certs) if not c["ca"] for k, v in identity(i, c).items()}
    theirs = {k: v for i, c in enumerate(other_certs) if not c["ca"] for k, v in identity(i, c).items()}
    found = []
    for field in sorted(mine.keys() & theirs.keys()):
        binary = field.endswith((".serial", ".public_key")) or ".ext." in field
        if mine[field] == theirs[field] and (binary or OPAQUE.search(mine[field]) or person_like(mine[field])):
            found.append((field, "same in two different signatures (stable identifier)"))
    return found


def payload(signed, auth, certs):
    """Shortcut.wflow inside a signed file, signature checked by the macOS aea tool."""
    contact_key = auth.get("SigningPublicKey")
    key = "hex:" + (contact_key if isinstance(contact_key, bytes) else certs[0]["public_key"]).hex()
    with tempfile.TemporaryDirectory() as work:
        archive, out = Path(work, "payload.aar"), Path(work, "out")
        out.mkdir()
        for command in (["aea", "decrypt", "-i", str(signed), "-o", str(archive), "-sign-pub-value", key],
                        ["aa", "extract", "-i", str(archive), "-d", str(out)]):
            result = subprocess.run(command, capture_output=True, check=False)
            if result.returncode:
                raise Unreadable(f"{command[0]} {command[1]} failed (rc {result.returncode}): signature or payload")
        wflow = out / "Shortcut.wflow"
        if not wflow.is_file():
            raise Unreadable("payload has no Shortcut.wflow")
        return plistlib.loads(wflow.read_bytes())


def inspect(signed, unsigned=None, compare=None, allow_record=False):
    """Report dict: verdict, findings, payload result, redacted certificate summary."""
    auth, certs = read(signed)
    found = findings(auth, certs, allow_record)
    result = "not checked"
    if unsigned is not None:
        result = "equal" if payload(signed, auth, certs) == plistlib.loads(Path(unsigned).read_bytes()) else "differs"
        if result == "differs":
            found.append(("payload", "differs from the unsigned build"))
    if compare is not None:
        if Path(compare).read_bytes() == Path(signed).read_bytes():
            raise Unreadable("--compare needs a signature of a different shortcut")
        found += stable((auth, certs), read(compare))
    return {"verdict": "FAIL" if found else "PASS", "findings": found, "payload": result,
            "keys": sorted(auth), "certs": [summary(index, cert, found) for index, cert in enumerate(certs)]}


def summary(index, cert, found):
    """Certificate fields for the report; signer values are shown only when they are Apple's constants."""
    flagged = {field for field, _ in found}

    def shown(part, pairs):
        out = []
        for key, value in pairs:
            field = f"cert[{index}].{part}.{key}"
            public = cert["ca"] or part == "issuer" or value in PUBLIC_VALUES or (key == "C" and len(value) == 2)
            safe = public and field not in flagged and not scan(field, value, True)
            out.append(f"{key}={value}" if safe else f"{key} present ({len(value)} chars)")
        return ", ".join(out) or "none"

    return {"ca": cert["ca"], "subject": shown("subject", cert["subject"]), "issuer": shown("issuer", cert["issuer"]),
            "san": shown("san", cert["san"]), "extensions": sorted(cert["extensions"])}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check a signed shortcut for signer identity before publishing.")
    parser.add_argument("signed")
    parser.add_argument("--unsigned", help="unsigned build; the signed payload must equal it as a parsed plist")
    parser.add_argument("--compare", help="signed file of a different shortcut; equal signer fields fail")
    parser.add_argument("--allow-icloud-record", action="store_true",
                        help="accept an iCloud share record id; only for a dedicated publisher Apple Account")
    args = parser.parse_args(argv)
    try:
        report = inspect(args.signed, args.unsigned, args.compare, args.allow_icloud_record)
    except (Unreadable, OSError, ValueError) as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        return 2
    print(f"Auth-data keys: {', '.join(report['keys'])}")
    for index, cert in enumerate(report["certs"]):
        print(f"cert[{index}] {'CA' if cert['ca'] else 'leaf'}: subject {cert['subject']}; issuer {cert['issuer']}; "
              f"SAN {cert['san']}; extensions {', '.join(cert['extensions']) or 'none'}")
    print(f"Payload vs unsigned build: {report['payload']}")
    for field, reason in report["findings"]:
        print(f"FAIL {field}: {reason}")
    print(f"Verdict: {report['verdict']}")
    return 1 if report["findings"] else 0


if __name__ == "__main__":
    sys.exit(main())
