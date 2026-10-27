"""Thin wrapper: fetch current scoreboard."""

from tools.match_api.client import MatchApiClient


def get_scoreboard(client: MatchApiClient | None = None) -> dict:
    return (client or MatchApiClient()).get_scoreboard()