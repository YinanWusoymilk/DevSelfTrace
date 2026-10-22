"""Tests for app_study/server.py (run with: python -m unittest discover -s tests/py -v).

Requests are sent straight to the Bottle WSGI app, so no server process is started.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from wsgiref.util import setup_testing_defaults

APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "app_study"))
sys.path.insert(0, APP_DIR)

import server  # noqa: E402

SAMPLE = {
    "logs": [
        {
            "ID": 1,
            "Timestamps": {"start": 0, "end": 12.5},
            "TimeInState": "12.500",
            "Label1": "To Understand Context",
            "Label2": "([Reading and Comprehension, IDE])",
            "Label3": "Neutral",
        }
    ]
}


def call(method, path, body=None, raw=None):
    """Send one request to the app and return (status code, response bytes)."""
    environ = {}
    setup_testing_defaults(environ)
    data = raw if raw is not None else (b"" if body is None else json.dumps(body).encode("utf-8"))
    environ.update({
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "wsgi.input": io.BytesIO(data),
        "CONTENT_LENGTH": str(len(data)),
        "CONTENT_TYPE": "application/json",
    })
    response = {}

    def start_response(status, headers, exc_info=None):
        response["status"] = int(status.split()[0])

    chunks = server.app(environ, start_response)
    try:
        payload = b"".join(chunks)
    finally:
        if hasattr(chunks, "close"):
            chunks.close()
    return response["status"], payload


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.json_file = os.path.join(self.tmp, "session.json")
        with open(self.json_file, "w", encoding="utf-8") as f:
            json.dump(SAMPLE, f)
        server.json_path = self.json_file
        server.video_path = None

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def read_file(self):
        with open(self.json_file, encoding="utf-8") as f:
            return json.load(f)

    def read_text(self):
        with open(self.json_file, encoding="utf-8") as f:
            return f.read()

    def test_home_serves_the_annotation_page(self):
        status, body = call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>DevSelfTrace</title>", body)
        self.assertIn(b"static/app.js", body)

    def test_static_scripts_are_served(self):
        for name, marker in [("core.js", b"DSTCore"), ("storage.js", b"DSTStorage"), ("app.js", b"initialization")]:
            status, body = call("GET", f"/static/{name}")
            self.assertEqual(status, 200, name)
            self.assertIn(marker, body, name)

    def test_initialize_reports_where_to_load_from(self):
        status, body = call("POST", "/initialize_html")
        self.assertEqual(status, 200)
        info = json.loads(body)
        self.assertEqual(info["json_path"], "/files/json")
        self.assertIsNone(info["video_path"])

    def test_initialize_reports_video_when_given(self):
        server.video_path = os.path.join(self.tmp, "session.mp4")
        info = json.loads(call("POST", "/initialize_html")[1])
        self.assertEqual(info["video_path"], "/files/video")

    def test_initialize_passes_on_the_label_set(self):
        info = json.loads(call("POST", "/initialize_html")[1])
        self.assertIsNone(info["labelset"])  # no --labels: the page uses its default

        server.labelset = server.load_labelset(os.path.join(APP_DIR, "..", "labels", "cups.json"))
        try:
            info = json.loads(call("POST", "/initialize_html")[1])
        finally:
            server.labelset = None
        self.assertEqual(info["labelset"]["name"], "CUPS")

    def test_load_labelset_rejects_files_that_are_not_label_sets(self):
        not_labels = os.path.join(self.tmp, "not_labels.json")
        with open(not_labels, "w", encoding="utf-8") as f:
            json.dump({"logs": []}, f)
        with self.assertRaises(ValueError):
            server.load_labelset(not_labels)

    def test_initialize_reports_an_unreadable_logs_file(self):
        with open(self.json_file, "w", encoding="utf-8") as f:
            f.write("{not json")
        info = json.loads(call("POST", "/initialize_html")[1])
        self.assertEqual(info["status"], "error")

    def test_logs_file_is_served(self):
        status, body = call("GET", "/files/json")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), SAMPLE)

    def save(self, data, revision):
        status, body = call("POST", "/save", body={"revision": revision, "data": data})
        return status, json.loads(body)

    def test_save_writes_the_logs_and_bumps_the_revision(self):
        new_data = {"logs": SAMPLE["logs"] + [dict(SAMPLE["logs"][0], ID=2, Label3="Positive")]}
        status, body = self.save(new_data, 0)  # the sample file has no revision yet, i.e. 0
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "success", "revision": 1})
        self.assertEqual(self.read_file(), dict(new_data, revision=1))

        status, body = self.save(new_data, 1)
        self.assertEqual(body["revision"], 2)

    def test_save_based_on_an_old_revision_is_refused(self):
        mine = {"logs": []}
        self.save({"logs": [dict(SAMPLE["logs"][0], Label3="Positive")]}, 0)  # someone else saves first
        before = self.read_file()

        status, body = self.save(mine, 0)
        self.assertEqual(status, 409)
        self.assertEqual(body["status"], "conflict")
        self.assertEqual(body["revision"], 1)
        self.assertEqual(body["data"], before)  # the other version, so the user can choose
        self.assertEqual(self.read_file(), before)  # nothing was overwritten

    def test_save_keeps_the_five_previous_versions(self):
        for revision in range(7):
            self.save({"logs": [], "step": revision}, revision)
        backups = sorted(name for name in os.listdir(self.tmp) if ".bak" in name)
        self.assertEqual(backups, [f"session.json.bak{i}" for i in range(1, 6)])
        with open(self.json_file + ".bak1", encoding="utf-8") as f:
            self.assertEqual(json.load(f)["revision"], 6)  # newest backup = version before the last save
        with open(self.json_file + ".bak5", encoding="utf-8") as f:
            self.assertEqual(json.load(f)["revision"], 2)

    def test_a_failed_write_leaves_the_logs_file_intact(self):
        before = self.read_text()
        original_dump = server.json.dump

        def crash_halfway(data, f, **kwargs):
            f.write('{"logs": [')  # half a file, then the disk "fails"
            raise OSError("disk full")

        server.json.dump = crash_halfway
        try:
            status, body = self.save({"logs": []}, 0)
        finally:
            server.json.dump = original_dump
        self.assertEqual(status, 500)
        self.assertEqual(body["status"], "error")
        self.assertEqual(self.read_text(), before)
        self.assertEqual([n for n in os.listdir(self.tmp) if n.endswith(".tmp")], [])

    def test_save_over_an_unreadable_file_keeps_it_as_a_backup(self):
        with open(self.json_file, "w", encoding="utf-8") as f:
            f.write("{not json")
        status, body = self.save({"logs": []}, 0)
        self.assertEqual(status, 200)
        with open(self.json_file + ".bak1", encoding="utf-8") as f:
            self.assertEqual(f.read(), "{not json")

    def test_save_rejects_a_malformed_request(self):
        status, _ = call("POST", "/save", body={"revision": 0})
        self.assertEqual(status, 400)
        status, _ = call("POST", "/save", raw=b"{not json")
        self.assertEqual(status, 400)
        self.assertEqual(self.read_file(), SAMPLE)

    def test_old_unchecked_save_endpoint_is_gone(self):
        status, _ = call("POST", "/update_json", body={"logs": []})
        self.assertEqual(status, 404)
        self.assertEqual(self.read_file(), SAMPLE)

    def test_video_route_without_a_video(self):
        status, body = call("GET", "/files/video")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "error")


if __name__ == "__main__":
    unittest.main()
