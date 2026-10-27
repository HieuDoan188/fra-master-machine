"""Benchmark repo - a tiny deterministic repo for 100-bug benchmarks.

Contains three pure functions (mirroring fastapi/utils.py bugs) so the
benchmark exercises the REAL pipeline (patch + pytest) without copying a
59MB repo per item.
"""

import re
import shutil
from pathlib import Path

SOURCE = '''import re


def is_body_allowed_for_status_code(status_code):
    if status_code is None:
        return True
    if status_code in {"default", "1XX", "2XX", "3XX", "4XX", "5XX"}:
        return True
    current_status_code = int(status_code)
    return not (current_status_code < 200 or current_status_code in {204, 205, 304})


def get_path_param_names(path):
    return set(re.findall("{(.*?)}", path))


def deep_dict_update(main_dict, update_dict):
    for key, value in update_dict.items():
        if key in main_dict and isinstance(main_dict[key], dict) and isinstance(value, dict):
            deep_dict_update(main_dict[key], value)
        elif key in main_dict and isinstance(main_dict[key], list) and isinstance(update_dict[key], list):
            main_dict[key] = main_dict[key] + update_dict[key]
        else:
            main_dict[key] = value
'''

PATTERNS = {
    "P1": {
        "old": "return not (current_status_code < 200 or current_status_code in {204, 205, 304})",
        "new": "return not (current_status_code < 200 or current_status_code in {204, 505, 506})",
        "test": (
            "from mini_utils import is_body_allowed_for_status_code\n\n"
            "def test_no_body_on_304():\n"
            "    assert is_body_allowed_for_status_code(304) is False\n"
        ),
    },
    "P2": {
        "old": 'return set(re.findall("{(.*?)}", path))',
        "new": 'return set(re.findall("{(.*)}", path))',
        "test": (
            "from mini_utils import get_path_param_names\n\n"
            "def test_path_params_extracted():\n"
            '    assert get_path_param_names("/users/{id}/posts/{pid}") == {"id", "pid"}\n'
        ),
    },
    "P3": {
        "old": "main_dict[key] = main_dict[key] + update_dict[key]",
        "new": "main_dict[key] = update_dict[key]",
        "test": (
            "from mini_utils import deep_dict_update\n\n"
            "def test_deep_list_merge():\n"
            "    d = {'a': [1]}\n"
            "    deep_dict_update(d, {'a': [2]})\n"
            "    assert d['a'] == [1, 2]\n"
        ),
    },
}

FIX_PATCHES_BENCH = {
    "P1": {"file": "mini_utils.py", "old": PATTERNS["P1"]["new"], "new": PATTERNS["P1"]["old"]},
    "P2": {"file": "mini_utils.py", "old": PATTERNS["P2"]["new"], "new": PATTERNS["P2"]["old"]},
    "P3": {"file": "mini_utils.py", "old": PATTERNS["P3"]["new"], "new": PATTERNS["P3"]["old"]},
}


class BenchmarkRepoBuilder:
    """Builds a small repo with N deterministic bugs (patterns P1..P3 cycling)."""

    def __init__(self, work_root: str, num_bugs: int):
        self.work_root = Path(work_root)
        self.num_bugs = num_bugs

    def build(self) -> tuple[str, dict]:
        target = self.work_root / "bench-repo"
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        (target / "mini_utils.py").write_text(SOURCE)

        patches: dict[str, dict] = {}
        for idx in range(1, self.num_bugs + 1):
            pattern = PATTERNS[f"P{(idx - 1) % 3 + 1}"]
            item_id = f"BUG-{idx:03d}"
            patches[item_id] = dict(FIX_PATCHES_BENCH[f"P{(idx - 1) % 3 + 1}"])
            test_file = target / f"tests/test_{item_id.lower()}.py"
            test_file.parent.mkdir(exist_ok=True)
            test_file.write_text(pattern["test"])

        utils = target / "mini_utils.py"
        text = utils.read_text()
        for pattern in PATTERNS.values():
            if pattern["old"] not in text:
                raise RuntimeError("pattern not found")
            text = text.replace(pattern["old"], pattern["new"])
        utils.write_text(text)
        return str(target), patches