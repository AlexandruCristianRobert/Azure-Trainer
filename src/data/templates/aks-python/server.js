export const SERVER_SOURCE = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import app

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/info":
            self.send_error(404)
            return
        body = json.dumps(app.info()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()
`
