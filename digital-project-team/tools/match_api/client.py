"""MatchApiClient - the only place DPT talks to the competition platform.

If BTC changes the API, only this file (and the thin wrappers in this package)
needs to change. Mock mode returns deterministic fixtures so the whole brain
can be exercised without a live match.
"""

import os
from dataclasses import dataclass, field

import requests


@dataclass
class MatchItem:
    item_id: str
    item_type: str
    title: str = ""
    status: str = "visible"
    deadline_minutes: float | None = None
    mvs: list = field(default_factory=list)


@dataclass
class MatchApiConfig:
    base_url: str = os.getenv("MATCH_API_BASE_URL", "http://localhost:8000")
    token: str = os.getenv("MATCH_API_TOKEN", "")
    timeout_seconds: int = int(os.getenv("MATCH_API_TIMEOUT_SECONDS", "30"))
    mock: bool = os.getenv("MATCH_API_MOCK", "1") == "1"


class MatchApiClient:
    def __init__(self, config: MatchApiConfig | None = None):
        self.config = config or MatchApiConfig()

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.config.token:
            headers["Authorization"] = f"Bearer {self.config.token}"
        return headers

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        url = f"{self.config.base_url.rstrip('/')}{path}"
        resp = requests.request(method, url, json=payload, headers=self._headers(), timeout=self.config.timeout_seconds)
        resp.raise_for_status()
        return resp.json()

    def get_items(self) -> list[MatchItem]:
        if self.config.mock:
            return [
                MatchItem(item_id="BUG-01", item_type="BUG", title="Login returns 500 on empty password"),
                MatchItem(item_id="CR-01", item_type="CR", title="Add pagination to /users"),
            ]
        data = self._request("GET", "/items")
        return [MatchItem(**row) for row in data]

    def get_scoreboard(self) -> dict:
        if self.config.mock:
            return {"team": {"rank": 1, "score": 310, "accepted": 4, "failed": 0}}
        return self._request("GET", "/scoreboard")

    def get_mvs(self, item_id: str) -> list[str]:
        if self.config.mock:
            return [f"{item_id} mock MVS: happy path returns 200"]
        data = self._request("GET", f"/items/{item_id}/mvs")
        return data.get("mvs", [])

    def start_working(self, item_id: str) -> dict:
        if self.config.mock:
            return {"item_id": item_id, "status": "started"}
        return self._request("POST", f"/items/{item_id}/start")

    def submit(self, item_id: str, patch: str, evidence: dict | None = None) -> dict:
        if self.config.mock:
            return {"item_id": item_id, "status": "accepted", "score": 100}
        return self._request("POST", f"/items/{item_id}/submit", {"patch": patch, "evidence": evidence or {}})