"""Bug injector - introduces real bugs into a copy of the target repo.

Used to build a realistic competition backlog: the repo has real defects,
MVS tests fail, and the system must fix them for real.
"""

import shutil
from pathlib import Path

BUG_DEFS = {
    "BUG-01": {
        "file": "fastapi/utils.py",
        "old": "return not (current_status_code < 200 or current_status_code in {204, 205, 304})",
        "new": "return not (current_status_code < 200 or current_status_code in {204, 501, 502})",
        "title": "is_body_allowed_for_status_code wrongly allows body for 304",
        "mvs": ["is_body_allowed_for_status_code(304) must return False"],
    },
    "BUG-02": {
        "file": "fastapi/utils.py",
        "old": 'return set(re.findall("{(.*?)}", path))',
        "new": 'return set(re.findall("{(.*)}", path))',
        "title": "get_path_param_names greedy regex merges params",
        "mvs": ['get_path_param_names("/users/{id}/posts/{pid}") must equal {"id", "pid"}'],
    },
    "BUG-03": {
        "file": "fastapi/utils.py",
        "old": "main_dict[key] = main_dict[key] + update_dict[key]",
        "new": "main_dict[key] = update_dict[key]",
        "title": "deep_dict_update drops existing list items on merge",
        "mvs": ["deep_dict_update({'a': [1]}, {'a': [2]}) must leave {'a': [1, 2]}"],
    },
}

MVS_TEST_SOURCES = {
    "BUG-01": '''import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.utils import is_body_allowed_for_status_code


def test_bug01_no_body_on_304():
    assert is_body_allowed_for_status_code(304) is False
''',
    "BUG-02": '''import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.utils import get_path_param_names


def test_bug02_path_params_extracted():
    assert get_path_param_names("/users/{id}/posts/{pid}") == {"id", "pid"}
''',
    "BUG-03": '''import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.utils import deep_dict_update


def test_bug03_deep_list_merge():
    d = {"a": [1]}
    deep_dict_update(d, {"a": [2]})
    assert d["a"] == [1, 2]
''',
}


class BugInjector:
    """Copies a clean repo and injects BUG-01..03 into the copy."""

    def __init__(self, source_repo: str, work_root: str):
        self.source = Path(source_repo)
        self.work_root = Path(work_root)

    def inject(self) -> str:
        target = self.work_root / "fastapi-buggy"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(self.source, target, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        for bug_id, spec in BUG_DEFS.items():
            path = target / spec["file"]
            text = path.read_text()
            if spec["old"] not in text:
                raise RuntimeError(f"{bug_id}: pattern not found in {spec['file']}")
            path.write_text(text.replace(spec["old"], spec["new"]))
        for bug_id, source in MVS_TEST_SOURCES.items():
            test_file = target / f"tests/test_{bug_id.lower()}.py"
            test_file.parent.mkdir(exist_ok=True)
            test_file.write_text(source)
        return str(target)