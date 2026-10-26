"""PI investigator - gathers symptoms and affected components."""

from core.contracts.models import Item


class Investigator:
    def gather(self, item: Item) -> dict:
        return {
            "item_id": item.item_id,
            "symptoms": [item.title, item.description],
            "affected_components": self._locate(item),
        }

    def _locate(self, item: Item) -> list[str]:
        return ["unknown-component"]