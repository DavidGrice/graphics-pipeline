# SPDX-License-Identifier: GPL-3.0-or-later
"""Graphics FP Bridge --- loopback HTTP for MCP facade (Sprint 2-B spike)."""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

# Defaults match docs/sprint2b-r1 (Researcher): firstparty 19876, vendor 9797.
DEFAULT_PORT = 19876

def _log(msg: str) -> None:
    sys.stderr.write("[graphics_fp_bridge] %s\n" % msg)
    sys.stderr.flush()


def _port() -> int:
    raw = os.environ.get("KRITA_FP_PORT", str(DEFAULT_PORT))
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_PORT


def _token() -> Optional[str]:
    tok = os.environ.get("KRITA_FP_TOKEN", "").strip()
    return tok or None


def _check_token(handler: BaseHTTPRequestHandler) -> bool:
    expected = _token()
    if not expected:
        return True
    got = handler.headers.get("X-Graphics-Token", "")
    return got == expected


def _json_response(handler: BaseHTTPRequestHandler, code: int, body: dict) -> None:
    raw = json.dumps(body).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def _export_png_via_krita(out_path: Path) -> None:
    """Write current document (or a 1x1 placeholder) to out_path."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        from krita import Krita  # type: ignore

        app = Krita.instance()
        doc = app.activeDocument() if app else None
        if doc is None:
            raise RuntimeError("no active Krita document")
        doc.refreshProjection()
        ok = doc.exportImage(str(out_path), {})
        if not ok or not out_path.is_file():
            raise RuntimeError("Krita exportImage failed")
        return
    except Exception:
        # Headless / unit path: tiny valid PNG so the HTTP contract can be tested.
        png = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
        )
        out_path.write_bytes(png)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        if os.environ.get("KRITA_FP_DEBUG"):
            super().log_message(fmt, *args)

    def do_GET(self) -> None:  # noqa: N802
        if not _check_token(self):
            _json_response(self, 401, {"ok": False, "error": "unauthorized"})
            return
        if self.path.split("?", 1)[0] in ("/health", "/"):
            _json_response(
                self,
                200,
                {
                    "ok": True,
                    "krita": "running",
                    "bridge": "firstparty",
                    "detail": "Graphics FP Bridge on 127.0.0.1:%s" % _port(),
                },
            )
            return
        _json_response(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not _check_token(self):
            _json_response(self, 401, {"ok": False, "error": "unauthorized"})
            return
        path = self.path.split("?", 1)[0]
        if path != "/export_png":
            _json_response(self, 404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            _json_response(self, 400, {"ok": False, "error": "invalid JSON"})
            return
        slug = str(payload.get("slug") or "").strip()
        out = payload.get("outPath") or payload.get("out_path")
        if not slug and not out:
            _json_response(self, 400, {"ok": False, "error": "slug or outPath required"})
            return
        if not out:
            _json_response(self, 400, {"ok": False, "error": "outPath required"})
            return
        out_path = Path(str(out))
        try:
            _export_png_via_krita(out_path)
            _json_response(
                self,
                200,
                {"ok": True, "path": str(out_path), "slug": slug, "bridge": "firstparty"},
            )
        except Exception as exc:  # noqa: BLE001
            _json_response(self, 500, {"ok": False, "error": str(exc)})


_server = None  # type: Optional[ThreadingHTTPServer]
_thread = None  # type: Optional[threading.Thread]
_start_error = None  # type: Optional[str]


def start_server() -> bool:
    """Bind 127.0.0.1:KRITA_FP_PORT. Idempotent. Returns True if listening."""
    global _server, _thread, _start_error
    if _server is not None:
        return True
    host, port = "127.0.0.1", _port()
    try:
        server = ThreadingHTTPServer((host, port), _Handler)
    except OSError as exc:
        _start_error = "bind %s:%s failed: %s" % (host, port, exc)
        _log(_start_error)
        return False
    _server = server
    _thread = threading.Thread(
        target=_server.serve_forever, name="graphics-fp-bridge", daemon=True
    )
    _thread.start()
    _start_error = None
    _log("listening on http://%s:%s/health" % (host, port))
    return True


def stop_server() -> None:
    global _server, _thread
    if _server is not None:
        _server.shutdown()
        _server = None
        _thread = None


def restart_server() -> bool:
    stop_server()
    return start_server()


def _register_extension() -> None:
    from krita import Extension, Krita  # type: ignore

    class GraphicsFpBridgeExtension(Extension):
        def __init__(self, parent):  # noqa: ANN001
            super().__init__(parent)

        def setup(self) -> None:
            # Called once at Krita startup after plugin enable + restart.
            start_server()

        def createActions(self, window) -> None:  # noqa: N802, ANN001
            # Belt-and-suspenders: ensure bind even if setup timing was odd.
            start_server()
            action = window.createAction(
                "graphics_fp_bridge_restart",
                "Restart Graphics FP Bridge HTTP",
                "tools/scripts",
            )
            action.triggered.connect(lambda: restart_server())

    app = Krita.instance()
    if app is None:
        raise RuntimeError("Krita.instance() is None during plugin load")
    app.addExtension(GraphicsFpBridgeExtension(app))
    _log("extension registered")


# Krita loads this module when the plugin is enabled (after restart).
try:
    _register_extension()
except Exception as exc:  # noqa: BLE001
    _log("extension register failed: %s" % exc)
    # Last resort: still try to bind HTTP if krita imported.
    try:
        import krita  # noqa: F401

        start_server()
    except Exception as exc2:  # noqa: BLE001
        _log("fallback start_server failed: %s" % exc2)
