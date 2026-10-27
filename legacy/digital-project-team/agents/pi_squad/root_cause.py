"""Root cause analyzer - ranks hypotheses."""

from core.contracts.models import Item


class RootCauseAnalyzer:
    def analyze(self, item: Item, hypotheses: list[str]) -> str:
        return hypotheses[0] if hypotheses else "no-hypothesis"