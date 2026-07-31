from typing import List, Optional

import os
import shutil
import stat
import zipfile
import urllib.request  # Replaced 'git' with built-in web request module

import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

MODEL_PREFERENCES = {
    "minimal": [
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash-lite",
        "gemini-flash-lite-latest",
    ],
    "medium": [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-flash-latest",
    ],
    "everything": [
        "gemini-omni-flash-preview",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-flash-latest",
    ],
}

PROMPTS = {
    "minimal": (
        "Analyze the provided codebase. Provide the response cleanly formatted in Markdown "
        "(use headers and bullet points where appropriate, avoid raw markdown block tags if "
        "unnecessary). In 1 short paragraph, explain the core idea. Follow with a bulleted list "
        "of the tech stack (Frontend, Backend, Database)."
    ),
    "medium": (
        "Analyze the provided codebase. Format the output cleanly in Markdown. Provide a "
        "high-level architectural overview, list the main features, and outline database "
        "models/schemas."
    ),
    "everything": (
        "Analyze the provided codebase and provide an exhaustive, A-to-Z technical breakdown "
        "formatted in Markdown. Include: "
        "1. Complete System Architecture\n"
        "2. Tech Stack & Key Libraries\n"
        "3. Database Schema & Data Flow\n"
        "4. Key Features\n"
        "5. File/Directory Breakdown\n"
        "6. Potential Security or Technical Debt Issues."
    ),
}

LEVEL_LABELS = {
    "minimal": "Quick Summary",
    "medium": "Standard Architecture",
    "everything": "Deep Dive",
}


def _remove_readonly(func, path, excinfo):
    """Callback for shutil.rmtree to force-delete read-only files."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _clear_upload_dir(upload_dir: str) -> None:
    if os.path.exists(upload_dir):
        shutil.rmtree(upload_dir, onerror=_remove_readonly)


@app.post("/analyze")
async def analyze_project(
    files: Optional[List[UploadFile]] = File(None),
    level: str = Form("medium"),
    mode: str = Form("temp"),
    user_api_key: Optional[str] = Form(None),
    github_url: Optional[str] = Form(None),
):
    if user_api_key:
        genai.configure(api_key=user_api_key)
    else:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

    upload_dir = "uploaded_projects/current_scan"

    _clear_upload_dir(upload_dir)
    os.makedirs(upload_dir, exist_ok=True)

    project_name = "Uploaded_Project"

    try:
        # CASE 1: User provided a GitHub Repository URL (REWRITTEN FOR VERCEL)
        if github_url:
            print(f"Downloading repository from {github_url}...")
            try:
                # Extract owner and repo name from the URL
                clean_url = github_url.rstrip("/").replace(".git", "")
                owner_repo = clean_url.split("github.com/")[-1]

                # Use GitHub's API to get a downloadable zip of the default branch
                zip_url = f"https://api.github.com/repos/{owner_repo}/zipball"
                zip_path = os.path.join(upload_dir, "repo.zip")

                # GitHub requires a User-Agent header to use their API
                req = urllib.request.Request(zip_url, headers={"User-Agent": "Mozilla/5.0"})

                with urllib.request.urlopen(req) as response, open(zip_path, "wb") as out_file:
                    shutil.copyfileobj(response, out_file)

                with zipfile.ZipFile(zip_path, "r") as zip_ref:
                    zip_ref.extractall(upload_dir)

                os.remove(zip_path)
                project_name = owner_repo.split("/")[-1]

            except Exception as e:
                return {
                    "error": (
                        "Failed to download repository. Ensure the URL is public and valid. "
                        f"Details: {str(e)}"
                    )
                }

        # CASE 2: User uploaded a single .zip file
        elif files and len(files) == 1 and files[0].filename.endswith(".zip"):
            zip_path = os.path.join(upload_dir, files[0].filename)
            with open(zip_path, "wb") as buffer:
                shutil.copyfileobj(files[0].file, buffer)

            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(upload_dir)

            os.remove(zip_path)
            project_name = files[0].filename.replace(".zip", "")

        # CASE 3: User uploaded an unzipped folder (multiple files)
        elif files:
            for file in files:
                file_path = os.path.join(upload_dir, file.filename)
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)

            if files and ("/" in files[0].filename or "\\" in files[0].filename):
                sep = "/" if "/" in files[0].filename else "\\"
                project_name = files[0].filename.split(sep)[0]
        else:
            return {"error": "No files or GitHub URL provided."}

        # Scan and aggregate text using scanner.py
        codebase_text = process_codebase(upload_dir)

    finally:
        _clear_upload_dir(upload_dir)

    prompt_instruction = PROMPTS.get(level, PROMPTS["medium"])
    full_prompt = f"{prompt_instruction}\n\nHere is the codebase:\n\n{codebase_text}"

    preferred_models = MODEL_PREFERENCES.get(level, MODEL_PREFERENCES["medium"])

    summary = None
    used_model = None
    last_error = ""

    for model_name in preferred_models:
        try:
            print(f"Attempting model: {model_name}...")
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(full_prompt)
            summary = response.text
            used_model = model_name
            print(f"Success! Generated summary using model: {used_model}")
            break
        except Exception as e:
            last_error = str(e).lower()
            print(f"Model '{model_name}' failed with error: {e}. Trying next available fallback...")
            continue

    if not summary:
        if (
            "api key" in last_error
            or "authentication" in last_error
            or "unauthenticated" in last_error
            or "invalid" in last_error
        ):
            return {"error": "Invalid API Key provided. Please check your key and try again."}

        summary = (
            "⚠️ **Analysis Failed:** Attempted to process your request across all fallback models, "
            "but all listed models were unavailable or exceeded quota limits."
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