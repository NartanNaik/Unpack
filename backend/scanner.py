import os

# Directories that never contain useful source (dependencies, build output, caches, ML artifacts)
IGNORE_DIRS = {
    'node_modules', '.git', 'venv', '.venv', '__pycache__', 'env', '.env',
    'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', '.idea', '.vscode', '.cache',
    '.parcel-cache', '.turbo', 'site-packages', '.pytest_cache', '.mypy_cache', '.tox',
    'vendor', 'target', 'coverage', '.vercel', 'pods', '.gradle', '__macosx',
    'uploaded_projects', 'datasets', 'checkpoints', 'logs', 'wandb', 'tensorboard',
}

# Exact (lowercase) file names to skip: lock files and secret files
IGNORE_FILES = {
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'pipfile.lock',
    'cargo.lock', 'gemfile.lock', 'composer.lock', '.ds_store', 'thumbs.db',
}

# Binary, media, archive, font and ML data extensions
IGNORE_EXTS = (
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.pdf',
    '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.pyc', '.mp4', '.mov',
    '.mp3', '.wav', '.ttf', '.otf', '.woff', '.woff2', '.eot', '.map', '.lock',
    '.min.js', '.min.css', '.ipynb',
    '.csv', '.tsv', '.jsonl', '.parquet', '.arrow', '.db', '.sqlite',
    '.pt', '.pth', '.h5', '.hdf5', '.bin', '.onnx', '.npy', '.npz', '.pkl', '.tfrecords',
)

MAX_FILE_SIZE_BYTES = 300 * 1024
MAX_TOTAL_CHARACTERS = 400_000
TREE_BUDGET_CHARS = 6_000

# Lower number = more important = included first when the budget is tight
MANIFESTS = {
    'package.json', 'requirements.txt', 'pyproject.toml', 'pipfile', 'go.mod', 'cargo.toml',
    'pom.xml', 'build.gradle', 'composer.json', 'gemfile', 'dockerfile', 'docker-compose.yml',
    'docker-compose.yaml', 'vercel.json', 'netlify.toml', 'vite.config.js', 'vite.config.ts',
    'next.config.js', 'tsconfig.json', 'schema.prisma', 'manage.py', 'makefile',
}
ENTRY_STEMS = {'main', 'app', 'index', 'server', 'run', 'wsgi', 'asgi', 'manage', 'cli'}
CODE_EXTS = {
    '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.kt', '.go', '.rs', '.rb', '.php', '.cs',
    '.cpp', '.c', '.h', '.hpp', '.swift', '.scala', '.vue', '.svelte', '.sql', '.sh', '.dart',
}


def _priority(rel_path: str) -> int:
    name = os.path.basename(rel_path).lower()
    stem, ext = os.path.splitext(name)
    if name.startswith('readme'):
        return 0
    if name in MANIFESTS:
        return 1
    if stem in ENTRY_STEMS and ext in CODE_EXTS:
        return 2
    if ext in CODE_EXTS:
        return 3
    if ext in {'.css', '.scss', '.html', '.json', '.yml', '.yaml', '.toml', '.md', '.txt'}:
        return 4
    return 5


def _skip_dir(name: str) -> bool:
    return name.lower() in IGNORE_DIRS


def _skip_file(name: str) -> bool:
    lower = name.lower()
    if lower in IGNORE_FILES or lower.startswith('.env'):
        return True
    return lower.endswith(IGNORE_EXTS)


def _build_tree(paths):
    text = "Project file tree:\n" + "\n".join(paths)
    if len(text) > TREE_BUDGET_CHARS:
        text = text[:TREE_BUDGET_CHARS].rsplit("\n", 1)[0] + "\n... (tree truncated)"
    return text


def process_codebase(extract_path: str, max_chars: int = MAX_TOTAL_CHARACTERS) -> str:
    """
    Walks the project, filters out junk, and returns one string for the AI:
    a file tree first, then file contents ordered by importance
    (README, manifests, entry points, source code, everything else).
    Stops adding files when max_chars is reached and lists what was left out.
    """
    max_chars = max(5_000, int(max_chars))
    candidates = []

    for root, dirs, files in os.walk(extract_path):
        dirs[:] = sorted(d for d in dirs if not _skip_dir(d))
        for name in sorted(files):
            if _skip_file(name):
                continue
            full = os.path.join(root, name)
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            if size == 0 or size > MAX_FILE_SIZE_BYTES:
                continue
            rel = os.path.relpath(full, extract_path).replace("\\", "/")
            candidates.append((rel, full, size))

    if not candidates:
        return ""

    candidates.sort(key=lambda c: (_priority(c[0]), c[0].count("/"), c[2]))

    tree = _build_tree(sorted(c[0] for c in candidates))
    parts = [tree]
    used = len(tree)
    per_file_cap = max(4_000, max_chars // 6)
    left_out = []

    for rel, full, _size in candidates:
        remaining = max_chars - used
        if remaining < 1_500:
            left_out.append(rel)
            continue
        try:
            with open(full, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError:
            continue
        if "\x00" in content:  # binary file that slipped through
            continue

        allowed = min(per_file_cap, remaining - 120)
        note = ""
        if len(content) > allowed:
            content = content[:allowed]
            note = "\n[... file truncated ...]"
        chunk = f"\n\n--- Start of {rel} ---\n{content}{note}\n--- End of {rel} ---"
        parts.append(chunk)
        used += len(chunk)

    if left_out:
        listing = "\n".join(left_out[:80])
        extra = f"\n... and {len(left_out) - 80} more" if len(left_out) > 80 else ""
        parts.append(
            "\n\n[Some files were not included because of the size limit. "
            f"They exist in the project but their contents are not shown:\n{listing}{extra}]"
        )

    return "".join(parts)