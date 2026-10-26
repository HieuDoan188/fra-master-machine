"""Fix patches - the "fixes" the coding engine produces for each bug.

In a real match these come from OpenHands; here they are pre-written so the
simulation can prove the pipeline end-to-end with REAL pytest runs.
"""

FIX_PATCHES = {
    "BUG-01": {
        "file": "fastapi/utils.py",
        "old": "return not (current_status_code < 200 or current_status_code in {204, 501, 502})",
        "new": "return not (current_status_code < 200 or current_status_code in {204, 205, 304})",
    },
    "BUG-02": {
        "file": "fastapi/utils.py",
        "old": 'return set(re.findall("{(.*)}", path))',
        "new": 'return set(re.findall("{(.*?)}", path))',
    },
    "BUG-03": {
        "file": "fastapi/utils.py",
        "old": "main_dict[key] = update_dict[key]",
        "new": "main_dict[key] = main_dict[key] + update_dict[key]",
    },
}