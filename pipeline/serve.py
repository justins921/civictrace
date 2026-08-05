#!/usr/bin/env python3
"""HTTP trigger for the CivicTrace daily refresh.

Railway's cron mode never executed this container, so scheduling moved out to an
external cron service (cron-job.org) and this process is what it calls. That is
also the more honest split: the schedule is somebody else's job, and this only
has to run the refresh and say what happened.

  POST/GET /refresh?token=…   start a refresh, return 202 immediately
           /status            last run, JSON, no token needed
           /healthz           liveness

The token is the same CT_INGEST_TOKEN the loader uses to write, so a caller who
can trigger a refresh could already have written the data directly — no new
authority is being handed out here. Requests without it get 401 and are not
logged with the query string.

Only one refresh runs at a time. A second caller during a run gets 409 rather
than a second process competing to replace the same tables.
"""
import json, os, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import daily_update

TOKEN = os.environ.get("CT_INGEST_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))

_lock = threading.Lock()
_state = {"running": False, "started": None, "finished": None,
          "result": None, "error": None, "runs": 0}


def _run():
    started = time.time()
    with _lock:
        _state.update(running=True, started=started, finished=None, result=None, error=None)
    try:
        code = daily_update.main()
        result = "ok" if code == 0 else f"failed (exit {code})"
        err = None
    except Exception:
        result, err = "failed", traceback.format_exc()[-2000:]
    with _lock:
        _state.update(running=False, finished=time.time(), result=result, error=err,
                      runs=_state["runs"] + 1)
    print(f"[serve] refresh {result} in {round(time.time() - started)}s", flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, payload):
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # the default logger prints the full path, which would put the token in
        # the deploy logs on every single scheduled call
        print(f"[serve] {self.command} {urlparse(self.path).path} {args[1] if len(args) > 1 else ''}",
              flush=True)

    def _handle(self):
        route = urlparse(self.path)
        path = route.path.rstrip("/") or "/"

        if path in ("/healthz", "/"):
            return self._send(200, {"service": "civictrace-refresh", "running": _state["running"]})

        if path == "/status":
            with _lock:
                s = dict(_state)
            return self._send(200, s)

        if path == "/refresh":
            if not TOKEN:
                return self._send(500, {"error": "CT_INGEST_TOKEN is not set on this service"})
            given = parse_qs(route.query).get("token", [""])[0] or \
                self.headers.get("X-CivicTrace-Token", "")
            if given != TOKEN:
                return self._send(401, {"error": "bad or missing token"})
            with _lock:
                if _state["running"]:
                    return self._send(409, {"error": "a refresh is already running",
                                            "started": _state["started"]})
            threading.Thread(target=_run, daemon=True).start()
            # 202: accepted, not finished. The caller is a cron service with a
            # short timeout; it should not sit holding a connection for ten
            # minutes to learn something /status will tell it.
            return self._send(202, {"started": True, "check": "/status"})

        self._send(404, {"error": "not found"})

    do_GET = _handle
    do_POST = _handle


if __name__ == "__main__":
    print(f"[serve] listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
