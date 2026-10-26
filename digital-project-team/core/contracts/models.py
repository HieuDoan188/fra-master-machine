"""Shared domain contracts - the single source of truth for item shapes."""

from dataclasses import dataclass, field
from enum import Enum


class ItemType(str, Enum):
    TASK = "TASK"
    CR = "CR"
    BUG = "BUG"
    PI = "PI"


class ItemStatus(str, Enum):
    VISIBLE = "VISIBLE"
    STARTED = "STARTED"
    IMPLEMENTING = "IMPLEMENTING"
    VERIFYING = "VERIFYING"
    READY_TO_SUBMIT = "READY_TO_SUBMIT"
    SUBMITTED = "SUBMITTED"
    FAILED = "FAILED"
    CLOSED = "CLOSED"


@dataclass
class Item:
    item_id: str
    item_type: ItemType
    title: str = ""
    description: str = ""
    status: ItemStatus = ItemStatus.VISIBLE
    deadline_seconds_left: float | None = None
    mvs: list = field(default_factory=list)
    priority_base: int = 0
    squad: str = ""
    score: int = 0
    submitted: bool = False
    accepted: bool = False
    evidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "item_id": self.item_id,
            "item_type": self.item_type.value,
            "title": self.title,
            "description": self.description,
            "status": self.status.value,
            "deadline_seconds_left": self.deadline_seconds_left,
            "mvs": self.mvs,
            "priority_base": self.priority_base,
            "squad": self.squad,
            "score": self.score,
            "submitted": self.submitted,
            "accepted": self.accepted,
        }


@dataclass
class ScoreboardEntry:
    rank: int = 0
    score: int = 0
    accepted: int = 0
    failed: int = 0


@dataclass
class MatchSnapshot:
    items: list[Item] = field(default_factory=list)
    scoreboard: ScoreboardEntry = field(default_factory=ScoreboardEntry)
    elapsed_seconds: float = 0.0
    remaining_seconds: float = 0.0