"""Repository memory - stores scanned knowledge and answers impact queries."""

import json
from pathlib import Path

from knowledge.scanner import RepoKnowledge, RepoScanner


class RepositoryMemory:
    def __init__(self, store_dir: str = "memory/repository_memory"):
        self.store_dir = Path(store_dir)
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self._knowledge: dict[str, RepoKnowledge] = {}

    def index(self, repo_path: str, name: str | None = None) -> RepoKnowledge:
        key = name or Path(repo_path).name
        k = RepoScanner(repo_path).scan()
        self._knowledge[key] = k
        (self.store_dir / f"{key}.json").write_text(json.dumps(vars(k), indent=2, default=str))
        return k

    def get(self, name: str) -> RepoKnowledge | None:
        return self._knowledge.get(name)

    def impacted_files(self, name: str, symbol: str) -> list[str]:
        k = self.get(name)
        if not k:
            return []
        hits = []
        for rel, imports in k.import_graph.items():
            if symbol in imports or symbol.lower() in rel.lower():
                hits.append(rel)
        return hits

    def summary(self, name: str) -> str:
        k = self.get(name)
        if not k:
            return "not indexed"
        return (
            f"{name}: {k.language}/{k.framework}, build={k.build_system}, tests={k.test_system}, "
            f"{k.file_count} files, {k.line_count} lines, entries={k.entry_points}"
        )