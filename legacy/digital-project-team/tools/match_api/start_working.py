"""Thin wrapper: start working on an item (unlocks MVS)."""

from tools.match_api.client import MatchApiClient


def start_working(item_id: str, client: MatchApiClient | None = None) -> dict:
    return (client or MatchApiClient()).start_working(item_id)