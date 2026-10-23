"""Copy the annotation page into docs/app/ so GitHub Pages serves it as the online version.

docs/ is the GitHub Pages site (https://yinanwusoymilk.github.io/DevSelfTrace/), so the copy is
online at .../DevSelfTrace/app/. app_study/ stays the one place to edit the page; the copy only
differs in declaring browser mode, so it never asks for server.py, and in adding a version tag
(?v=<hash of the file>) to its script and style links, so browsers never mix an updated file
with a cached old one after an update.

Usage:
    python scripts/sync_pages.py          # rewrite docs/app/ from app_study/
    python scripts/sync_pages.py --check  # exit 1 if docs/app/ is out of date
"""
import hashlib
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = os.path.join(ROOT, "app_study")
TARGET = os.path.join(ROOT, "docs", "app")
MODE_AUTO = b'<meta name="devselftrace-mode" content="auto" />'
MODE_BROWSER = b'<meta name="devselftrace-mode" content="browser" />'
IGNORED = {".DS_Store"}


def expected_files():
    """Map of path (relative to docs/app) -> bytes that docs/app should contain."""
    files = {}
    with open(os.path.join(SOURCE, "index.html"), "rb") as f:
        page = f.read()
    if MODE_AUTO not in page:
        raise SystemExit('app_study/index.html is missing <meta name="devselftrace-mode" content="auto" />')
    static = os.path.join(SOURCE, "static")
    for folder, _, names in os.walk(static):
        for name in names:
            if name in IGNORED:
                continue
            path = os.path.join(folder, name)
            with open(path, "rb") as f:
                files[os.path.relpath(path, SOURCE)] = f.read()

    def versioned(match):
        path = match.group(2).decode()
        if path not in files:
            return match.group(0)
        tag = hashlib.sha1(files[path]).hexdigest()[:8].encode()
        return match.group(1) + b'="' + match.group(2) + b"?v=" + tag + b'"'

    page = page.replace(MODE_AUTO, MODE_BROWSER)
    files["index.html"] = re.sub(rb'(src|href)="(static/[^"?]+)"', versioned, page)
    return files


def current_files():
    files = {}
    for folder, _, names in os.walk(TARGET):
        for name in names:
            if name in IGNORED:
                continue
            path = os.path.join(folder, name)
            with open(path, "rb") as f:
                files[os.path.relpath(path, TARGET)] = f.read()
    return files


def differences():
    """Paths that are missing, extra, or different in docs/app (empty list = up to date)."""
    expected, current = expected_files(), current_files()
    return sorted(path for path in set(expected) | set(current) if expected.get(path) != current.get(path))


def main():
    if "--check" in sys.argv:
        stale = differences()
        if stale:
            print("docs/app is out of date (run: python scripts/sync_pages.py):")
            for path in stale:
                print(f"  {path}")
            sys.exit(1)
        print("docs/app is up to date")
        return
    files = expected_files()
    if os.path.exists(TARGET):
        shutil.rmtree(TARGET)
    for path, content in files.items():
        destination = os.path.join(TARGET, path)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with open(destination, "wb") as f:
            f.write(content)
    print(f"wrote {len(files)} files to docs/app")


if __name__ == "__main__":
    main()
