"""Local-only static preview with clean HTML routes; no third-party dependencies."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/notes":
            self.path = "/notes/index.html"
        elif path == "/notes/expansion-map":
            self.path = "/notes/expansion-map.html"
        elif path == "/notes/where-batteries-earn-most":
            self.path = "/notes/where-batteries-earn-most.html"
        elif path == "/notes/kardashev-stack":
            self.path = "/notes/kardashev-stack.html"
        elif path in {"/tools", "/kardashev", "/live", "/titans", "/roadmap", "/essay", "/why", "/sources", "/base", "/about", "/contact", "/privacy"}:
            self.path = path + ".html"
        super().do_GET()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Megawatt preview: http://127.0.0.1:8765", flush=True)
    server.serve_forever()
