import json
import os
import shutil
import stat
import tempfile
import urllib.error
import urllib.request
import zipfile
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

from scanner import process_codebase

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://unpack-tau.vercel.app",
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def _env(name: str) -> str:
    """Read an env var and strip whitespace / accidental surrounding quotes."""
    return (os.getenv(name) or "").strip().strip("\"'")


OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# OpenRouter specific model tags. Free model IDs get retired often, so these are
# only the first choices; live free models are appended as fallbacks at request time.
MODEL_PREFERENCES = {
    "minimal": [
        "openrouter/free",
        "cohere/north-mini-code:free",
    ],
    "medium": [
        "openrouter/free",
        "cohere/north-mini-code:free",
    ],
    "everything": [
        "openrouter/free",
        "cohere/north-mini-code:free",
    ],
    "diagnose": [
        "openrouter/free",
        "cohere/north-mini-code:free",
    ],
}

MAX_TOKENS = {
    "minimal": 2000,
    "medium": 8000,
    "everything": 8000,
    "diagnose": 12000,
}

PROMPTS = {
    "minimal": (
        "Analyze the provided codebase. Provide the response cleanly formatted in Markdown (use headers and bullet points where appropriate, avoid raw markdown block tags if unnecessary). "
        "In 1 short paragraph, explain the core idea. Follow with a bulleted list of the tech stack (Frontend, Backend, Database)."
    ),
    "medium": (
        "Analyze the provided codebase. Format the output cleanly in Markdown. Provide a high-level architectural overview, "
        "list the main features, and outline database models/schemas."
    ),
    # Original Deep Dive prompt (previously commented out) - active again.
    "everything": (
        "Analyze the provided codebase and provide an exhaustive, A-to-Z technical breakdown formatted in Markdown. Include: "
        "1. Complete System Architecture\n"
        "2. Tech Stack & Key Libraries\n"
        "3. Database Schema & Data Flow\n"
        "4. Key Features\n"
        "5. File/Directory Breakdown\n"
        "6. Potential Security or Technical Debt Issues."
    ),
    # Long forensic audit prompt - used by the "Diagnose" button.
    "diagnose": (
        "You are an expert Principal Software Engineer and Codebase Auditor. Your task is to perform an exhaustive, deep-dive forensic analysis of the provided codebase. "
        "You must not just summarize the project at a high level; you need to map out every single file, trace all inter-file dependencies, identify broken or missing connections, "
        "and provide production-ready, fully written code solutions for any gaps.\n\n"
        "Execute the analysis and structure your output in Markdown following these exact sections:\n\n"
        "## 1. Complete System Architecture & Control Flow\n"
        "- Provide a comprehensive structural breakdown of how the application boots, runs, and handles requests/events.\n"
        "- Map out the lifecycle of data and control flow across client, server, database, and third-party services.\n"
        "- Detail how different modules, packages, or services communicate with one another.\n\n"
        "## 2. Tech Stack, Frameworks & Key Libraries\n"
        "- List every framework, library, and tool utilized in the project along with its exact role.\n"
        "- Identify version mismatches, deprecated packages, or potential upgrade risks.\n\n"
        "## 3. Database Schema, Models & Data Pipeline\n"
        "- Detail every database schema, table, collection, entity relationship (ER), and index.\n"
        "- Trace end-to-end data flow from input validation to persistence and retrieval.\n"
        "- Highlight any missing constraints, missing indexes, or data integrity risks.\n\n"
        "## 4. Comprehensive File-by-File Directory Breakdown\n"
        "- Enumerate every file and directory in the project tree.\n"
        "- For each file, provide:\n"
        "  - Its exact responsibility and architectural role.\n"
        "  - Functions, classes, and exported/imported modules within it.\n"
        "  - Direct dependencies (which files it imports and which files call it).\n\n"
        "## 5. Cross-File Consistency & Missing Logic Audit (Crucial)\n"
        "- Perform a rigorous cross-reference check between all files to find orphaned code, broken imports, or mismatched interfaces "
        "(e.g., a function called in `File A` that is missing or has an incorrect signature in `File B`).\n"
        "- For **every single missing function, broken link, or incomplete implementation** discovered:\n"
        "  - Specify precisely **where** it is called and **where** it should reside.\n"
        "  - Provide the **exact, fully written code implementation** to fix the issue. Do **not** use vague placeholders, TODO comments, or stub code "
        "(e.g., `// TODO: implement logic here`). Every fix must be complete, syntactically valid, and production-ready.\n\n"
        "## 6. Security Vulnerabilities, Performance Bottlenecks & Technical Debt\n"
        "- List all security flaws (e.g., injection risks, improper auth checks, missing input sanitization, exposed secrets).\n"
        "- Highlight performance bottlenecks, memory leaks, or unoptimized queries.\n"
        "- Outline architectural technical debt and provide actionable refactoring recommendations for each item."
    ),
}

LEVEL_LABELS = {
    "minimal": "Quick Summary",
    "medium": "Standard Architecture",
    "everything": "Deep Dive",
    "diagnose": "Diagnose",
}


# ---------------------------------------------------------------------------
# HTTP helper (stdlib only, so no new dependencies)
# ---------------------------------------------------------------------------
def http_json(url, method="GET", headers=None, body=None, timeout=20):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req_headers = {"Content-Type": "application/json", "User-Agent": "Unpack/1.0"}
    req_headers.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw}


# ---------------------------------------------------------------------------
# Supabase auth + per-user OpenRouter key provisioning
# ---------------------------------------------------------------------------
def _supabase_service_headers():
    service_key = _env("SUPABASE_SERVICE_ROLE_KEY")
    return {"apikey": service_key, "Authorization": f"Bearer {service_key}"}


def get_supabase_user(access_token: str) -> dict:
    """Validate a Supabase access token and return the user (id, email)."""
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    service_key = _env("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.")

    status, data = http_json(
        f"{supabase_url}/auth/v1/user",
        headers={"apikey": service_key, "Authorization": f"Bearer {access_token}"},
    )
    if status != 200 or not data or not data.get("id"):
        raise PermissionError("Invalid or expired login session.")
    return {"id": data["id"], "email": data.get("email") or "unknown"}


def get_stored_key(user_id: str) -> Optional[str]:
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    status, data = http_json(
        f"{supabase_url}/rest/v1/user_keys?user_id=eq.{user_id}&select=openrouter_key",
        headers=_supabase_service_headers(),
    )
    if status == 200 and isinstance(data, list) and data:
        return data[0].get("openrouter_key")
    return None


def store_key(user_id: str, email: str, key: str, key_hash: Optional[str]) -> None:
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    headers = _supabase_service_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    status, data = http_json(
        f"{supabase_url}/rest/v1/user_keys?on_conflict=user_id",
        method="POST",
        headers=headers,
        body={
            "user_id": user_id,
            "email": email,
            "openrouter_key": key,
            "openrouter_key_hash": key_hash,
        },
    )
    if status not in (200, 201, 204):
        raise RuntimeError(f"Failed to store user key in Supabase (HTTP {status}): {data}")


def create_openrouter_user_key(email: str) -> dict:
    """Calls OpenRouter's Provisioning API to spawn a $0-capped key for a user."""
    management_key = _env("OPENROUTER_MANAGEMENT_KEY")
    if not management_key:
        raise RuntimeError("OPENROUTER_MANAGEMENT_KEY is missing in environment variables.")

    status, data = http_json(
        f"{OPENROUTER_BASE}/keys",
        method="POST",
        headers={"Authorization": f"Bearer {management_key}"},
        body={
            "name": f"User Key - {email}",
            "limit": 0,  # hard cap at $0.00 so only free models can be used
        },
    )
    if status not in (200, 201) or not data or not data.get("key"):
        raise RuntimeError(f"OpenRouter key creation failed (HTTP {status}): {data}")

    return {"key": data["key"], "hash": (data.get("data") or {}).get("hash")}


def ensure_user_key(access_token: str) -> dict:
    """Return the user's OpenRouter key, creating and storing it on first use."""
    user = get_supabase_user(access_token)
    key = get_stored_key(user["id"])
    created = False
    if not key:
        new = create_openrouter_user_key(user["email"])
        store_key(user["id"], user["email"], new["key"], new["hash"])
        key = new["key"]
        created = True
    return {"key": key, "created": created, "email": user["email"], "user_id": user["id"]}


@app.post("/provision-key")
def provision_key(authorization: Optional[str] = Header(None)):
    """Call this from the frontend right after login. The key stays server-side."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        result = ensure_user_key(token)
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ready": True, "created": result["created"], "email": result["email"]}


# ---------------------------------------------------------------------------
# Model helpers
# ---------------------------------------------------------------------------
def get_free_models(api_key: str, min_context: int = 32000, limit: int = 5) -> List[str]:
    """Fetch currently available free models, largest context first."""
    status, data = http_json(
        f"{OPENROUTER_BASE}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=15,
    )
    if status != 200 or not data:
        return []
    models = data.get("data", [])
    free = []
    for m in models:
        pricing = m.get("pricing") or {}
        try:
            is_free = float(pricing.get("prompt", 1)) == 0 and float(pricing.get("completion", 1)) == 0
        except (TypeError, ValueError):
            continue
        if is_free and (m.get("context_length") or 0) >= min_context:
            free.append(m)
    free.sort(key=lambda m: m.get("context_length") or 0, reverse=True)
    return [m["id"] for m in free[:limit]]


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------
def _remove_readonly(func, path, excinfo):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def cleanup_dir(path: str) -> None:
    if path and os.path.exists(path):
        shutil.rmtree(path, onerror=_remove_readonly)


def safe_join(base: str, relative_path: str) -> str:
    """Join an untrusted relative path to base, refusing path traversal."""
    rel = relative_path.replace("\\", "/").lstrip("/")
    dest = os.path.normpath(os.path.join(base, rel))
    base_abs = os.path.abspath(base)
    if dest != base_abs and not dest.startswith(base_abs + os.sep):
        raise ValueError(f"Unsafe file path: {relative_path}")
    return dest


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------
@app.post("/analyze")
async def analyze_project(
    files: Optional[List[UploadFile]] = File(None),
    level: str = Form("medium"),
    mode: str = Form("temp"),
    access_token: Optional[str] = Form(None),   # Supabase session token (preferred)
    user_api_key: Optional[str] = Form(None),   # legacy fallback, no longer required
    github_url: Optional[str] = Form(None),
):
    # Resolve the OpenRouter key: auto-provisioned per logged-in user
    api_key = None
    if access_token:
        try:
            result = await run_in_threadpool(ensure_user_key, access_token)
            api_key = result["key"]
        except PermissionError:
            return {"error": "Your session has expired. Please log in again."}
        except Exception as e:
            print(f"Key provisioning failed: {e}")
            return {"error": f"Could not prepare your API access. Details: {str(e)}"}
    elif user_api_key:
        api_key = user_api_key

    if not api_key:
        return {"error": "Please log in to run an analysis."}

    client = OpenAI(base_url=OPENROUTER_BASE, api_key=api_key)

    upload_dir = tempfile.mkdtemp(prefix="scan_")
    project_name = "Uploaded_Project"

    try:
        if github_url:
            print(f"Downloading repository from {github_url}...")
            try:
                clean_url = github_url.strip().rstrip("/")
                if clean_url.endswith(".git"):
                    clean_url = clean_url[:-4]
                owner_repo = clean_url.split("github.com/")[-1]

                zip_url = f"https://api.github.com/repos/{owner_repo}/zipball"
                zip_path = os.path.join(upload_dir, "repo.zip")

                req = urllib.request.Request(zip_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as response, open(zip_path, "wb") as out_file:
                    shutil.copyfileobj(response, out_file)

                with zipfile.ZipFile(zip_path, "r") as zip_ref:
                    zip_ref.extractall(upload_dir)

                os.remove(zip_path)
                project_name = owner_repo.split("/")[-1]

            except Exception as e:
                return {"error": f"Failed to download repository. Details: {str(e)}"}

        elif files and len(files) == 1 and files[0].filename.endswith(".zip"):
            zip_path = os.path.join(upload_dir, "upload.zip")
            with open(zip_path, "wb") as buffer:
                shutil.copyfileobj(files[0].file, buffer)

            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(upload_dir)

            os.remove(zip_path)
            project_name = os.path.basename(files[0].filename)[: -len(".zip")]

        elif files:
            for file in files:
                file_path = safe_join(upload_dir, file.filename)
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)

            first = files[0].filename
            if "/" in first or "\\" in first:
                sep = "/" if "/" in first else "\\"
                project_name = first.split(sep)[0]
        else:
            return {"error": "No files or GitHub URL provided."}

        codebase_text = process_codebase(upload_dir)

    except ValueError as e:
        return {"error": str(e)}
    finally:
        cleanup_dir(upload_dir)

    prompt_instruction = PROMPTS.get(level, PROMPTS["medium"])
    full_prompt = (
        f"{prompt_instruction}\n\n"
        "Formatting rule: do not use emojis or emoticons anywhere in your response.\n\n"
        f"Here is the codebase:\n\n{codebase_text}"
    )

    preferred_models = list(MODEL_PREFERENCES.get(level, MODEL_PREFERENCES["medium"]))
    try:
        live_free = await run_in_threadpool(get_free_models, api_key)
        preferred_models += [m for m in live_free if m not in preferred_models]
    except Exception as e:
        print(f"Could not fetch live free model list: {e}")

    max_tokens = MAX_TOKENS.get(level, 8000)

    summary = None
    used_model = None
    errors = []

    for model_name in preferred_models:
        try:
            print(f"Attempting model: {model_name}...")
            response = await run_in_threadpool(
                lambda m=model_name: client.chat.completions.create(
                    model=m,
                    messages=[{"role": "user", "content": full_prompt}],
                    max_tokens=max_tokens,
                )
            )
            content = response.choices[0].message.content
            if not content:
                raise ValueError("Model returned an empty response.")
            summary = content
            used_model = model_name
            print(f"Success! Generated summary using model: {used_model}")
            break
        except Exception as e:
            errors.append(f"{model_name}: {e}")
            print(f"Model '{model_name}' failed with error: {e}. Trying next fallback...")
            continue

    if not summary:
        joined = " | ".join(errors).lower()
        if "401" in joined or "unauthorized" in joined or "invalid api key" in joined:
            return {"error": "Your API access was rejected by OpenRouter. Please log out and log in again."}

        summary = (
            "**Analysis Failed:** all fallback models failed.\n\n"
            + "\n".join(f"- {e}" for e in errors)
        )
        used_model = "None"

    level_label = LEVEL_LABELS.get(level, "Analysis")
    formatted_project_name = f"{project_name} [{level_label}]"

    return {
        "project_name": formatted_project_name,
        "level": level,
        "mode": mode,
        "model_used": used_model,
        "summary": summary,
    }