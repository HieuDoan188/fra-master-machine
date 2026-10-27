"""Repo scanner - builds knowledge about a target repository in seconds.

Produces: folder structure, framework, build/test system, dependencies,
and a lightweight call-graph approximation from imports.
"""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next", "vendor", "target"}

FRAMEWORK_HINTS = {
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "express": "Express",
    "spring": "Spring Boot",
    "gin": "Gin",
    "react": "React",
    "vue": "Vue",
    "pytorch": "PyTorch",
    "tensorflow": "TensorFlow",
}


@dataclass
class RepoKnowledge:
    root: str
    language: str = "unknown"
    framework: str = "unknown"
    build_system: str = "unknown"
    test_system: str = "unknown"
    folders: list = field(default_factory=list)
    entry_points: list = field(default_factory=list)
    dependencies: list = field(default_factory=list)
    import_graph: dict = field(default_factory=dict)
    file_count: int = 0
    line_count: int = 0


class RepoScanner:
    def __init__(self, root: str):
        self.root = Path(root)

    def scan(self) -> RepoKnowledge:
        k = RepoKnowledge(root=str(self.root))
        self._walk(k)
        self._detect_stack(k)
        self._detect_entry_points(k)
        return k

    def _walk(self, k: RepoKnowledge) -> None:
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            rel = os.path.relpath(dirpath, self.root)
            if rel != ".":
                k.folders.append(rel)
            for fn in filenames:
                k.file_count += 1
                path = Path(dirpath) / fn
                try:
                    k.line_count += sum(1 for _ in path.open(errors="ignore"))
                except OSError:
                    pass
                if fn.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java")):
                    self._collect_imports(path, k)

    def _collect_imports(self, path: Path, k: RepoKnowledge) -> None:
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            return
        imports = re.findall(r"(?:import|from)\s+([a-zA-Z_][\w.]*)", text)
        rel = str(path.relative_to(self.root))
        k.import_graph[rel] = [imp.split(".")[0] for imp in imports[:50]]
        for imp in imports:
            mod = imp.split(".")[0]
            if mod not in FRAMEWORK_HINTS and mod not in k.dependencies:
                k.dependencies.append(mod)

    def _detect_stack(self, k: RepoKnowledge) -> None:
        markers = {
            "pyproject.toml": ("python", "poetry/pip"),
            "setup.py": ("python", "pip"),
            "requirements.txt": ("python", "pip"),
            "package.json": ("javascript/typescript", "npm/yarn"),
            "go.mod": ("go", "go modules"),
            "pom.xml": ("java", "maven"),
            "build.gradle": ("java", "gradle"),
            "Cargo.toml": ("rust", "cargo"),
        }
        for name, (lang, build) in markers.items():
            if (self.root / name).exists():
                k.language, k.build_system = lang, build
                break
        if (self.root / "pytest.ini").exists() or (self.root / "tox.ini").exists() or (self.root / ".pytest_cache").exists():
            k.test_system = "pytest"
        elif (self.root / "jest.config.js").exists() or (self.root / "vitest.config.ts").exists():
            k.test_system = "jest/vitest"
        for dep in k.dependencies:
            if dep in FRAMEWORK_HINTS:
                k.framework = FRAMEWORK_HINTS[dep]
                break

    def _detect_entry_points(self, k: RepoKnowledge) -> None:
        for candidate in ["main.py", "app.py", "server.py", "manage.py", "wsgi.py", "asgi.py", "index.ts", "main.go"]:
            for dirpath, _, filenames in os.walk(self.root):
                if candidate in filenames:
                    k.entry_points.append(os.path.relpath(os.path.join(dirpath, candidate), self.root))
                    break