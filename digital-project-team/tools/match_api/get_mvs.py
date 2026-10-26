"""Thin wrapper: fetch MVS for an item."""

from tools.match_api.client import MatchApiClient


def get_mvs(item_id: str, client: MatchApiClient | None = None) -> list[str]:
    return (client or MatchApiClient()).get_mvs(item_id)