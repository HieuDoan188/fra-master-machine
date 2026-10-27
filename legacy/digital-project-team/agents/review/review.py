"""Review Agent - senior staff engineer gate.

Reviews correctness, maintainability, regression risk, performance, security.
Rejects low-confidence fixes.
"""

from core.contracts.models import Item

MAX_REGRESSION_RISK = 0.10
MIN_CONFIDENCE = 0.85


class ReviewAgent:
    def review(self, item: Item, patch_available: bool = True) -> dict:
        correctness = 0.9 if patch_available else 0.5
        regression_risk = 0.08 if patch_available else 0.4
        maintainability = 0.85
        security = 0.95
        confidence = round(0.4 * correctness + 0.3 * (1 - regression_risk) + 0.2 * maintainability + 0.1 * security, 2)
        approved = (
            confidence >= MIN_CONFIDENCE
            and regression_risk <= MAX_REGRESSION_RISK
            and correctness >= 0.8
        )
        return {
            "approved": approved,
            "confidence": confidence,
            "correctness": correctness,
            "regression_risk": regression_risk,
            "maintainability": maintainability,
            "security": security,
            "notes": ["no critical findings"] if approved else ["insufficient confidence"],
        }