#!/usr/bin/env python3
"""Checks inspect_signed.py on AEA1 files built by the macOS aea tool (macOS only: aea, aa, openssl)."""

import importlib.util
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # keep the module folder free of __pycache__
HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("inspect_signed", HERE / "inspect_signed.py")
inspect_signed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspect_signed)

UNSIGNED = HERE / "Publish to BrewPage.unsigned.shortcut"
OTHER_WFLOW = plistlib.dumps({"WFWorkflowActions": []}, fmt=plistlib.FMT_BINARY)
ECDSA_SHA256 = "1.2.840.10045.4.3.2"
CN, OU, O = "2.5.4.3", "2.5.4.11", "2.5.4.10"
RECORD_ID = "0123456789abcdef0123456789abcdef"


def tlv(tag, *parts):
    body = b"".join(parts)
    width = (len(body).bit_length() + 7) // 8
    head = bytes([len(body)]) if len(body) < 128 else bytes([0x80 | width]) + len(body).to_bytes(width, "big")
    return bytes([tag]) + head + body


def seq(*parts):
    return tlv(0x30, *parts)


def oid(dotted):
    first, second, *rest = (int(part) for part in dotted.split("."))
    out = bytes([40 * first + second])
    for number in rest:
        chunk = [number & 0x7F]
        while number > 0x7F:
            number >>= 7
            chunk.insert(0, 0x80 | (number & 0x7F))
        out += bytes(chunk)
    return tlv(0x06, out)


def name(pairs):
    return seq(*(tlv(0x31, seq(oid(key), tlv(0x0C, value.encode()))) for key, value in pairs))


def certificate(point, subject, serial, ca=False, emails=()):
    """Unsigned-signature X.509 certificate: enough for the inspector, which never checks the chain."""
    extensions = [seq(oid("2.5.29.19"), tlv(0x01, b"\xff"), tlv(0x04, seq(*[tlv(0x01, b"\xff")] * ca)))]
    if emails:
        extensions.append(seq(oid("2.5.29.17"), tlv(0x04, seq(*(tlv(0x81, email.encode()) for email in emails)))))
    tbs = seq(
        tlv(0xA0, tlv(0x02, b"\x02")), tlv(0x02, serial), seq(oid(ECDSA_SHA256)), name([(CN, "Example Root CA")]),
        seq(tlv(0x17, b"261120000000Z"), tlv(0x17, b"271120000000Z")), name(subject),
        seq(seq(oid("1.2.840.10045.2.1"), oid("1.2.840.10045.3.1.7")), tlv(0x03, b"\x00" + point)),
        tlv(0xA3, seq(*extensions)),
    )
    return seq(tbs, seq(oid(ECDSA_SHA256)), tlv(0x03, b"\x00" + bytes(8)))


def run(*command):
    subprocess.run([str(part) for part in command], check=True, capture_output=True)


class Fixtures:
    """P-256 keys and aea-signed files in one temporary folder."""

    def __init__(self, work):
        self.work, self.count = Path(work), 0
        self.keys = {label: self.keypair(label) for label in ("a", "b")}

    def keypair(self, label):
        key, public = self.work / f"{label}.pem", self.work / f"{label}.pub.der"
        run("openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", key)
        run("openssl", "ec", "-in", key, "-pubout", "-outform", "DER", "-out", public)
        return key, public.read_bytes()[-65:]

    def point(self, label):
        return self.keys[label][1]

    def signed(self, label, auth, wflow):
        self.count += 1
        folder = self.work / f"file{self.count}"
        (folder / "in").mkdir(parents=True)
        (folder / "in" / "Shortcut.wflow").write_bytes(wflow)
        (folder / "auth.plist").write_bytes(plistlib.dumps(auth, fmt=plistlib.FMT_BINARY))
        run("aa", "archive", "-d", folder / "in", "-o", folder / "payload.aar")
        run("aea", "encrypt", "-profile", "0", "-sign-priv", self.keys[label][0], "-auth-data", folder / "auth.plist",
            "-i", folder / "payload.aar", "-o", folder / "signed.shortcut")
        return folder / "signed.shortcut"


def outcome(report):
    return report["verdict"], report["findings"], report["payload"], report["certs"][0]


class InspectSignedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.fx = Fixtures(cls.temp.name)
        cls.root = certificate(cls.fx.point("b"), [(CN, "Example Root CA")], b"\x02", ca=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def leaf(self, subject, emails=(), label="a", serial=b"\x01"):
        return certificate(self.fx.point(label), subject, serial, emails=emails)

    def test_given_signed_file_when_inspected_then_signer_fields_and_payload_decide_the_verdict(self):
        clean = {"SigningCertificateChain": [self.leaf([(CN, "Shortcuts Signing"), (O, "Example")]), self.root]}
        apple_id = {
            "AppleIDCertificateChain": clean["SigningCertificateChain"], "AppleIDValidationRecord": b"placeholder",
            "SigningPublicKey": self.fx.point("a"), "SigningPublicKeySignature": b"placeholder",
        }
        personal = {"SigningCertificateChain": [
            self.leaf([(CN, "Jane Roe"), (OU, "+1 555 0100")], emails=["signer@example.invalid"]), self.root]}
        record = {"SigningCertificateChain": [self.leaf([(CN, RECORD_ID), (O, "Apple Inc.")]), self.root]}
        unsigned = UNSIGNED.read_bytes()
        clean_summary = {"ca": False, "subject": "CN present (17 chars), O present (7 chars)",
                         "issuer": "CN=Example Root CA", "san": "none", "extensions": ["2.5.29.19"]}
        record_summary = {**clean_summary, "subject": "CN present (32 chars), O=Apple Inc."}
        record_reason = "iCloud share record id: its public record shows the signer's account id"
        rows = [
            ("clean anyone-style signature passes", clean, unsigned, False,
             ("PASS", [], "equal", clean_summary)),
            ("Apple ID fields fail", apple_id, unsigned, False,
             ("FAIL", [("auth.AppleIDCertificateChain", "Apple ID field present"),
                       ("auth.AppleIDValidationRecord", "Apple ID field present"),
                       ("auth.SigningPublicKey", "unreviewed auth-data key"),
                       ("auth.SigningPublicKeySignature", "unreviewed auth-data key")], "equal", clean_summary)),
            ("name, phone and email in the signer certificate fail and stay redacted", personal, unsigned, False,
             ("FAIL", [("cert[0].subject.CN", "person-name-like value"), ("cert[0].subject.OU", "phone-like digit run"),
                       ("cert[0].san.email", "contains @"),
                       ("cert[0].san.email", "personal subject alternative name present")], "equal",
              {**clean_summary, "subject": "CN present (8 chars), OU present (11 chars)",
               "san": "email present (22 chars)", "extensions": ["2.5.29.17", "2.5.29.19"]})),
            ("iCloud share record id fails", record, unsigned, False,
             ("FAIL", [("cert[0].subject.CN", record_reason)], "equal", record_summary)),
            ("iCloud share record id passes for a dedicated account", record, unsigned, True,
             ("PASS", [], "equal", record_summary)),
            ("payload other than the unsigned build fails", clean, OTHER_WFLOW, False,
             ("FAIL", [("payload", "differs from the unsigned build")], "differs", clean_summary)),
        ]
        for rule, auth, wflow, allow, expected in rows:
            with self.subTest(rule=rule):
                report = inspect_signed.inspect(self.fx.signed("a", auth, wflow), UNSIGNED, allow_record=allow)
                self.assertEqual(outcome(report), expected, rule)

    def test_given_two_signed_shortcuts_when_compared_then_a_reused_signer_identity_fails(self):
        first = self.fx.signed("a", {"SigningCertificateChain": [self.leaf([(CN, "Shortcuts Signing")]), self.root]},
                               UNSIGNED.read_bytes())
        stable = "same in two different signatures (stable identifier)"
        rows = [
            ("same leaf certificate in both files", "a", b"\x01",
             ("FAIL", [("cert[0].public_key", stable), ("cert[0].serial", stable)])),
            ("fresh leaf certificate per file", "b", b"\x03", ("PASS", [])),
        ]
        for rule, label, serial, expected in rows:
            with self.subTest(rule=rule):
                chain = [self.leaf([(CN, "Shortcuts Signing")], label=label, serial=serial), self.root]
                second = self.fx.signed(label, {"SigningCertificateChain": chain}, OTHER_WFLOW)
                report = inspect_signed.inspect(first, compare=second)
                self.assertEqual((report["verdict"], report["findings"]), expected, rule)


if __name__ == "__main__":
    unittest.main(verbosity=2)
