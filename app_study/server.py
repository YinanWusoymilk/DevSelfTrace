from bottle import route, run, static_file
import bottle
import threading
import json
import argparse
import os
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

@app.post('/update_json')
def update_json():
    global json_path
    data = bottle.request.json
    try:
        with open(json_path, 'w', encoding='utf-8') as outfile:
            json.dump(data, outfile, indent=4)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

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
            'labeled_so_far': labeled_so_far
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

parser.add_argument('-p', '--path', help='Path to logs JSON file', required=True)
parser.add_argument('-v', '--video', help='Path to video file', required=False)

def main():
    global json_path, video_path
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

        Demo()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()


# Example Usage:-

# python3 server.py -p /absolute/path/to/log.json -v /absolute/path/to/video.mp4
# OR
# python3 server.py -p /absolute/path/to/log.json (When video is not to be provided via command line but is to be provided via the user-interface)