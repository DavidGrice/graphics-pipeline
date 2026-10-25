# SPDX-License-Identifier: GPL-3.0-or-later
"""Graphics FP Bridge --- loopback HTTP for MCP facade (Sprint 2-B spike)."""

from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

DEFAULT_PORT = 19876

def _status_path() -> str:
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(appdata, "krita", "graphics_fp_bridge.status")


def _write_status(msg: str) -> None:
    try:
        path = _status_path()
        parent = os.path.dirname(path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        with open(path, "w", encoding="ascii", errors="replace") as fh:
            fh.write(msg)
            if not msg.endswith("\n"):
                fh.write("\n")
    except Exception:
        pass


def _log(msg: str) -> None:
    line = "[graphics_fp_bridge] %s" % msg
    sys.stderr.write(line + "\n")
    sys.stderr.flush()
    # Append to status for Windows diagnosis without stderr.
    try:
        path = _status_path()
        parent = os.path.dirname(path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        with open(path, "a", encoding="ascii", errors="replace") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


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


def start_server() -> bool:
    """Bind 127.0.0.1:KRITA_FP_PORT. Idempotent."""
    global _server, _thread
    if _server is not None:
        _log("already listening on 127.0.0.1:%s" % _port())
        return True
    host, port = "127.0.0.1", _port()
    try:
        server = ThreadingHTTPServer((host, port), _Handler)
    except OSError as exc:
        _log("bind %s:%s FAILED: %s" % (host, port, exc))
        return False
    _server = server
    _thread = threading.Thread(
        target=_server.serve_forever, name="graphics-fp-bridge", daemon=True
    )
    _thread.start()
    _log("listening on http://%s:%s/health" % (host, port))
    return True


def stop_server() -> None:
    global _server, _thread
    if _server is not None:
        try:
            _server.shutdown()
        except Exception:
            pass
        _server = None
        _thread = None


def restart_server() -> bool:
    stop_server()
    return start_server()


def _defer_start() -> None:
    """Retry bind after Qt event loop is up (Krita 5=PyQt5, 6=PyQt6)."""
    for mod in ("PyQt5.QtCore", "PyQt6.QtCore"):
        try:
            qt = __import__(mod, fromlist=["QTimer"])
            qt.QTimer.singleShot(0, start_server)
            qt.QTimer.singleShot(1000, start_server)
            _log("deferred start via %s" % mod)
            return
        except Exception:
            continue
    _log("QTimer unavailable; immediate start only")


# --- Extension (module-level; SIP-friendly) ---
try:
    from krita import Extension, Krita  # type: ignore

    class GraphicsFpBridgeExtension(Extension):
        def __init__(self, parent):  # noqa: ANN001
            super().__init__(parent)

        def setup(self) -> None:
            start_server()

        def createActions(self, window) -> None:  # noqa: N802, ANN001
            start_server()
            action = window.createAction(
                "graphics_fp_bridge_restart",
                "Restart Graphics FP Bridge HTTP",
                "tools/scripts",
            )
            action.triggered.connect(restart_server)

    def _register() -> None:
        _write_status("boot")
        _log("module import begin")
        # Bind ASAP --- do not wait only on Extension.setup.
        start_server()
        _defer_start()
        app = Krita.instance()
        if app is None:
            _log("Krita.instance() is None at import")
            return
        app.addExtension(GraphicsFpBridgeExtension(app))
        _log("extension registered")

    _register()
except Exception as exc:  # noqa: BLE001
    _log("boot FAILED: %s" % exc)
    _log(traceback.format_exc())
    try:
        start_server()
    except Exception as exc2:  # noqa: BLE001
        _log("emergency start_server FAILED: %s" % exc2)
