from bottle import route, run, static_file
import bottle
import threading
import json
import argparse
import os
import shutil
import tempfile
from time import sleep
parser = argparse.ArgumentParser()

app = bottle.Bottle()
logs = ""
my_module = os.path.abspath(__file__)
parent_dir = os.path.dirname(my_module)
static_dir = os.path.join(parent_dir, 'static')
index_file_path = os.path.join(parent_dir, 'index.html')
json_path = ""
video_path = None
labelset = None  # label set from --labels; the page checks it and falls back to the default
save_lock = threading.Lock()
BACKUP_COUNT = 5  # previous versions kept as <logs file>.bak1 (newest) ... .bak5 (oldest)

@app.get("/")
def home():
    try:
        with open(index_file_path, encoding='utf-8') as fl:
            html = fl.read()
            return html
    except FileNotFoundError:
        return f"Error: index.html not found at {index_file_path}"

@app.get('/static/<filename:path>')
def server_static(filename):
    return static_file(filename, root=static_dir)

def rotate_backups(path):
    """Shift <path>.bak1..bak4 down one slot and copy the current file to .bak1."""
    for i in range(BACKUP_COUNT - 1, 0, -1):
        older = f"{path}.bak{i}"
        if os.path.exists(older):
            os.replace(older, f"{path}.bak{i + 1}")
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak1")

def atomic_write_json(path, data):
    """Write to a temporary file next to path, then swap it in, so a crash never leaves half a file."""
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=f".{os.path.basename(path)}.", suffix=".tmp")
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as outfile:
            json.dump(data, outfile, indent=4)
            outfile.flush()
            os.fsync(outfile.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

@app.post('/save')
def save():
    """Save the logs if the client edited the latest revision; otherwise report a conflict (409)."""
    global json_path
    try:
        payload = bottle.request.json
    except Exception:
        payload = None
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), dict):
        bottle.response.status = 400
        return {"status": "error", "message": "Expected {\"revision\": n, \"data\": {...}}"}
    base_revision = payload.get('revision', 0)

    with save_lock:
        try:
            with open(json_path, 'r', encoding='utf-8') as fl:
                current = json.load(fl)
        except (OSError, ValueError):
            current = None  # missing or unreadable; it is kept as .bak1 below
        if isinstance(current, dict):
            current_revision = current.get('revision', 0)
            if base_revision != current_revision:
                bottle.response.status = 409
                return {"status": "conflict", "revision": current_revision, "data": current}
        else:
            current_revision = base_revision

        data = dict(payload['data'])
        data['revision'] = current_revision + 1
        try:
            rotate_backups(json_path)
            atomic_write_json(json_path, data)
        except Exception as e:
            bottle.response.status = 500
            return {"status": "error", "message": str(e)}
    return {"status": "success", "revision": data['revision']}

@app.post('/initialize_html')
def initialize_html():
    global json_path, video_path
    try:
        with open(json_path, 'r', encoding='utf-8') as fl:
            data = json.load(fl)

        logs = data.get('logs', [])
        labeled_so_far = sum(1 for log in logs if log.get('label') != 'not_labeled')

        # Use absolute paths to serve files
        json_url = f"/files/json"
        video_url = f"/files/video" if video_path else None

        data_json = {
            'json_path': json_url,
            'video_path': video_url,
            'video_name': os.path.basename(video_path) if video_path else None,
            'labeled_so_far': labeled_so_far,
            'labelset': labelset
        }
        return data_json
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get('/files/json')
def serve_json():
    global json_path
    return static_file(os.path.basename(json_path), root=os.path.dirname(json_path))

@app.get('/files/video')
def serve_video():
    global video_path
    if video_path:  # Only serve if video path exists
        return static_file(os.path.basename(video_path), root=os.path.dirname(video_path))
    return {"status": "error", "message": "No video file provided"}

class Demo(object):
    def __init__(self):
        self.close_thread = True
        threading.Thread(target=self.demo_backend).start()
        app.run(host='localhost', port=8080)
        try:
            while True:
                sleep(1)
        except KeyboardInterrupt:
            print("Closing server...")
            self.close_thread = False

    def demo_backend(self):
        while self.close_thread:
            sleep(0.01)

def keep_v1_copy(path):
    """If path holds annotations in the old v1 format ({"logs": [...]}), copy it to
    <name>.v1.json before the page converts it to v2. Returns the copy's path, or None."""
    try:
        with open(path, encoding='utf-8') as fl:
            data = json.load(fl)
    except (OSError, ValueError):
        return None
    is_v1 = isinstance(data, dict) and isinstance(data.get('logs'), list) and 'intervals' not in data
    if not is_v1 or not data['logs']:
        return None  # nothing to keep
    root, _ = os.path.splitext(path)
    copy_path = f"{root}.v1.json"
    if not os.path.exists(copy_path):
        shutil.copy2(path, copy_path)
    return copy_path

def load_labelset(path):
    """Read a label set JSON file (see labels/). Full checks happen in the page."""
    with open(path, encoding='utf-8') as fl:
        data = json.load(fl)
    if not isinstance(data, dict) or not isinstance(data.get('dimensions'), list):
        raise ValueError(f"{path} is not a label set: expected an object with a \"dimensions\" list")
    return data

parser.add_argument('-p', '--path', help='Path to logs JSON file', required=True)
parser.add_argument('-v', '--video', help='Path to video file', required=False)
parser.add_argument('-l', '--labels', help='Path to a label set JSON file (default: labels/s-iase.json)', required=False)

def main():
    global json_path, video_path, labelset
    args = parser.parse_args()

    try:
        # Convert to absolute paths
        json_path = os.path.abspath(args.path)
        video_path = os.path.abspath(args.video) if args.video else None

        # Validate if files are present
        if not os.path.isfile(json_path):
            raise FileNotFoundError(f"JSON file not found: {json_path}")
        if video_path and not os.path.isfile(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        if args.labels:
            labelset = load_labelset(os.path.abspath(args.labels))
        v1_copy = keep_v1_copy(json_path)
        if v1_copy:
            print(f"{json_path} uses the old v1 format; the page will convert it. The original is kept as {v1_copy}")

        Demo()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()


# Example Usage:-

# python3 server.py -p /absolute/path/to/log.json -v /absolute/path/to/video.mp4
# OR, with a different label set (see labels/)
# python3 server.py -p /absolute/path/to/log.json -l ../labels/cups.json
# OR
# python3 server.py -p /absolute/path/to/log.json (When video is not to be provided via command line but is to be provided via the user-interface)