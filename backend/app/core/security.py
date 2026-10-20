"""Request checks for a backend that can spawn CLIs on this machine.

The API is bound to 127.0.0.1, and every request must also:
- name an allowed Host (stops DNS-rebinding pages from reaching it),
- carry the shared token the Next.js Studio proxy adds (other local pages cannot know it),
- for state changes: come from an allowed Origin when the browser sends one, and use a
  JSON or multipart body (a plain HTML form cannot send either with the token).
"""

from __future__ import annotations

import hmac
import json

from starlette.types import ASGIApp, Receive, Scope, Send

TOKEN_HEADER = "x-studio-token"
STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})
BODY_TYPES = ("application/json", "multipart/form-data")


class StudioGuard:
    def __init__(
        self,
        app: ASGIApp,
        *,
        token: str,
        allowed_hosts: tuple[str, ...],
        allowed_origins: tuple[str, ...],
    ) -> None:
        self.app = app
        self.token = token
        self.allowed_hosts = frozenset(h.lower() for h in allowed_hosts)
        self.allowed_origins = frozenset(o.lower().rstrip("/") for o in allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        problem = self._problem(scope["method"], headers)
        if problem is not None:
            status, message = problem
            await _reject(send, status, message)
            return
        await self.app(scope, receive, send)

    def _problem(self, method: str, headers: dict[str, str]) -> tuple[int, str] | None:
        host = _hostname(headers.get("host", ""))
        if host not in self.allowed_hosts:
            return 400, "Host not allowed."
        if not self.token:
            return 503, "STUDIO_TOKEN is not set; the Studio API is disabled."
        sent = headers.get(TOKEN_HEADER, "").encode("latin-1")
        if not hmac.compare_digest(sent, self.token.encode("utf-8")):
            return 401, "Missing or wrong Studio token."
        if method in STATE_CHANGING:
            origin = headers.get("origin")
            if origin is not None and origin.lower().rstrip("/") not in self.allowed_origins:
                return 403, "Origin not allowed."
            content_type = headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type not in BODY_TYPES:
                return 415, "Send application/json or multipart/form-data."
        return None


def _hostname(host: str) -> str:
    host = host.strip().lower()
    if host.startswith("["):  # [::1]:8000
        return host[: host.find("]") + 1]
    return host.rsplit(":", 1)[0] if ":" in host else host


async def _reject(send: Send, status: int, message: str) -> None:
    body = json.dumps({"detail": message}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
