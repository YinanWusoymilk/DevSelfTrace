"""Checks for the online copy in docs/app (run with: python -m unittest discover -s tests/py -v)."""
import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import sync_pages  # noqa: E402


class PagesTest(unittest.TestCase):
    def test_online_copy_matches_app_study(self):
        self.assertEqual(sync_pages.differences(), [], "docs/app is out of date; run: python scripts/sync_pages.py")

    def test_online_copy_never_asks_for_a_server(self):
        with open(os.path.join(ROOT, "docs", "app", "index.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertIn('<meta name="devselftrace-mode" content="browser" />', page)
        self.assertNotIn('content="auto"', page)

    def test_homepage_links_to_the_online_copy(self):
        with open(os.path.join(ROOT, "docs", "index.html"), encoding="utf-8") as f:
            self.assertIn('href="app/"', f.read())


if __name__ == "__main__":
    unittest.main()
