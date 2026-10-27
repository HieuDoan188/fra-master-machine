"""Expected Value engine - EV = score x success_rate x deadline_factor."""

import math


def deadline_factor(seconds_left: float, total_seconds: float = 2400.0) -> float:
    if seconds_left <= 0:
        return 0.0
    ratio = seconds_left / total_seconds
    return min(1.0, max(0.05, ratio))


def success_probability(base_confidence: float, complexity: float = 0.5) -> float:
    return max(0.0, min(1.0, base_confidence * (1.0 - 0.5 * complexity)))


def expected_value(score: float, success_rate: float, seconds_left: float, total_seconds: float = 2400.0) -> float:
    df = deadline_factor(seconds_left, total_seconds)
    return round(score * success_rate * df, 2)


def ev_of_item(item, base_confidence: float = 0.8, complexity: float = 0.5, total_seconds: float = 2400.0) -> float:
    if item.deadline_seconds_left is None:
        secs = total_seconds
    else:
        secs = item.deadline_seconds_left
    success = success_probability(base_confidence, complexity)
    return expected_value(float(item.score or item.priority_base), success, secs, total_seconds)