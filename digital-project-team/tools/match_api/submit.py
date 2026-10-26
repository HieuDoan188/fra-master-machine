"""Thin wrapper: submit an item. Irreversible - gate before calling."""

from tools.match_api.client import MatchApiClient


def submit(item_id: str, patch: str, evidence: dict | None = None, client: MatchApiClient | None = None) -> dict:
    return (client or MatchApiClient()).submit(item_id, patch, evidence)