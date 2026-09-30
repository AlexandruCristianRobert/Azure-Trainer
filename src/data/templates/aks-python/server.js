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

    def do_POST(self):
        if self.path != "/api/ask":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, UnicodeDecodeError):
            request = None
        if not isinstance(request, dict) or not isinstance(request.get("question"), str) or not request["question"].strip():
            response = {"status": 400, "body": {"error": "A question string is required."}}
        else:
            response = app.answer(request["question"])
        body = json.dumps(response["body"]).encode("utf-8")
        self.send_response(response["status"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()
`

// Diagnosis keeps application events separate from BaseHTTPRequestHandler's
// access output. Even an empty question enters the application's request scope.
export function diagnosisServerSource(healthServer) {
  return healthServer.replace('import app\n', 'import app\nfrom uuid import uuid4\nfrom training_diagnostics import set_request_id, reset_request_id\n')
    .replace('HTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()', 'print(f"Server startup: listening on port {app.PORT}", flush=True)\nHTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()')
    .replace('            response = app.answer(request["question"])', `            token = set_request_id(str(uuid4()))
            try:
                response = app.answer(request["question"])
            finally:
                reset_request_id(token)`)
}
