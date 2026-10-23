"""Tests for scripts/convert_v1_to_v2.py (run with: python -m unittest discover -s tests/py -v).

tests/js/convert.test.js checks the in-page converter against the same fixture, so both give
the same result.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import convert_v1_to_v2 as converter  # noqa: E402

FIXTURES = os.path.join(ROOT, "tests", "fixtures")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


SIASE = load(os.path.join(ROOT, "labels", "s-iase.json"))
CUPS = load(os.path.join(ROOT, "labels", "cups.json"))


class ConvertTest(unittest.TestCase):
    def test_fixture_converts_to_the_expected_intervals(self):
        session, warnings = converter.convert(load(os.path.join(FIXTURES, "v1_session.json")), SIASE)
        expected = load(os.path.join(FIXTURES, "v1_session_expected.json"))
        self.assertEqual(session["intervals"], expected["intervals"])
        self.assertEqual(len(warnings), expected["warnings"])
        self.assertEqual(session["schemaVersion"], 2)
        self.assertEqual(session["labelset"]["name"], "S-IASE")
        self.assertEqual(session["lastId"], 6)  # new intervals continue after the highest ID

    def test_commas_inside_custom_labels(self):
        actions = SIASE["dimensions"][1]
        self.assertEqual(converter.parse_pairs("([Search, Slack, Teams])", actions)[0], [{"action": "Search", "tool": "Slack, Teams"}])
        self.assertEqual(converter.parse_pairs("([Reading docs, then coding, IDE])", actions)[0], [{"action": "Reading docs, then coding", "tool": "IDE"}])
        pairs, ambiguous = converter.parse_pairs("([Foo, bar, baz])", actions)
        self.assertEqual(pairs, [{"action": "Foo, bar", "tool": "baz"}])
        self.assertEqual(len(ambiguous), 1)

    def test_any_label_set_maps_label_i_to_dimension_i(self):
        session, _ = converter.convert({"logs": [{"ID": 1, "Timestamps": {"start": 0, "end": 2}, "Label1": "Prompt Crafting"}]}, CUPS)
        self.assertEqual(session["intervals"], [{"id": 1, "start": 0, "end": 2, "duration": 2, "state": "Prompt Crafting"}])

    def test_v2_files_are_refused(self):
        with self.assertRaises(ValueError):
            converter.convert({"schemaVersion": 2, "intervals": []}, SIASE)


class CommandLineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.input = os.path.join(self.tmp, "p01.json")
        shutil.copy(os.path.join(FIXTURES, "v1_session.json"), self.input)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = converter.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_writes_next_to_the_input_and_keeps_the_input(self):
        with open(self.input, encoding="utf-8") as f:
            before = f.read()
        code, out, _ = self.run_cli(self.input)
        self.assertEqual(code, 0)
        self.assertIn("5 intervals", out)
        self.assertIn("note:", out)
        self.assertEqual(load(os.path.join(self.tmp, "p01.v2.json"))["schemaVersion"], 2)
        with open(self.input, encoding="utf-8") as f:
            self.assertEqual(f.read(), before)

    def test_out_dir_converts_several_files(self):
        second = os.path.join(self.tmp, "p02.json")
        shutil.copy(self.input, second)
        out_dir = os.path.join(self.tmp, "converted")
        code, _, _ = self.run_cli(self.input, second, "--out-dir", out_dir)
        self.assertEqual(code, 0)
        self.assertEqual(sorted(os.listdir(out_dir)), ["p01.json", "p02.json"])

    def test_does_not_replace_existing_output_without_force(self):
        target = os.path.join(self.tmp, "p01.v2.json")
        with open(target, "w", encoding="utf-8") as f:
            f.write("keep me")
        code, _, err = self.run_cli(self.input)
        self.assertEqual(code, 1)
        self.assertIn("exists", err)
        with open(target, encoding="utf-8") as f:
            self.assertEqual(f.read(), "keep me")
        self.assertEqual(self.run_cli(self.input, "--force")[0], 0)

    def test_uses_the_label_set_saved_in_the_file(self):
        data = {"labelset": CUPS, "logs": [{"ID": 1, "Timestamps": {"start": 0, "end": 1}, "Label1": "Not Thinking"}]}
        with open(self.input, "w", encoding="utf-8") as f:
            json.dump(data, f)
        self.run_cli(self.input)
        self.assertEqual(load(os.path.join(self.tmp, "p01.v2.json"))["intervals"][0]["state"], "Not Thinking")


if __name__ == "__main__":
    unittest.main()
