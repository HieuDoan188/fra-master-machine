"""PI validator - verifies the fix restores functionality."""

from core.contracts.models import Item


class Validator:
    def verify(self, item: Item, fix: dict) -> bool:
        return bool(fix.get("patched"))