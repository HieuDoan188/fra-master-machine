"""Thin wrapper: list visible/open items."""

from tools.match_api.client import MatchApiClient, MatchItem


def get_items(client: MatchApiClient | None = None) -> list[MatchItem]:
    return (client or MatchApiClient()).get_items()