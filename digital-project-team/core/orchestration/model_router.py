"""Model routing - simple tasks use cheap models, complex tasks use strong ones."""

from core.contracts.models import Item, ItemType

MODEL_TIERS = {
    "cheap": "fast-small-model",
    "standard": "balanced-model",
    "strong": "top-tier-model",
}


class ModelRouter:
    def route(self, item: Item) -> str:
        if item.item_type == ItemType.PI:
            return MODEL_TIERS["strong"]
        if item.item_type == ItemType.BUG:
            return MODEL_TIERS["standard"]
        if item.item_type == ItemType.CR:
            return MODEL_TIERS["standard"]
        return MODEL_TIERS["cheap"]