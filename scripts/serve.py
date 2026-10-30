"""Local-only static preview with clean HTML routes; no third-party dependencies."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/franklin':
            body = json.dumps({'enabled': False}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path in {"/ops", "/market", "/deploy", "/tools", "/kardashev", "/live", "/titans", "/roadmap", "/essay", "/why", "/sources", "/base", "/bench", "/about", "/contact", "/privacy"}:
            self.path = path + ".html"
        super().do_GET()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Megawatt preview: http://127.0.0.1:8765", flush=True)
    server.serve_forever()
