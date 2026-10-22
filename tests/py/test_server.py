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

    def test_initialize_reports_an_unreadable_logs_file(self):
        with open(self.json_file, "w", encoding="utf-8") as f:
            f.write("{not json")
        info = json.loads(call("POST", "/initialize_html")[1])
        self.assertEqual(info["status"], "error")

    def test_logs_file_is_served(self):
        status, body = call("GET", "/files/json")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), SAMPLE)

    def test_update_json_overwrites_the_logs_file(self):
        new_data = {"logs": SAMPLE["logs"] + [dict(SAMPLE["logs"][0], ID=2, Label3="Positive")]}
        status, body = call("POST", "/update_json", body=new_data)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "success")
        self.assertEqual(self.read_file(), new_data)

    def test_video_route_without_a_video(self):
        status, body = call("GET", "/files/video")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "error")


if __name__ == "__main__":
    unittest.main()
