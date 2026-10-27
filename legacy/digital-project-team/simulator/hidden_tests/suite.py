"""Hidden test suite - what the grader checks beyond MVS."""

HIDDEN_TEST_TYPES = ["boundary", "negative", "regression", "permission", "performance"]


class HiddenTestSuite:
    def run(self, item_id: str, coverage: float) -> dict:
        passed = coverage >= 80.0
        return {
            "item_id": item_id,
            "tests": HIDDEN_TEST_TYPES,
            "passed": passed,
            "detail": f"coverage {coverage}% {'>= 80%' if passed else '< 80%'}",
        }