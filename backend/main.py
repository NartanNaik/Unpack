from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import zipfile
import os
import shutil
import stat
import git
import google.generativeai as genai
from dotenv import load_dotenv
from scanner import process_codebase

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

# Map tasks to prioritized fallback lists of Gemini models
MODEL_PREFERENCES = {
    "minimal": [
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash-lite",
        "gemini-flash-lite-latest"
    ],
    "medium": [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-flash-latest"
    ],
    "everything": [
        "gemini-omni-flash-preview",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-flash-latest"
    ]
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
    "everything": (
        "Analyze the provided codebase and provide an exhaustive, A-to-Z technical breakdown formatted in Markdown. Include: "
        "1. Complete System Architecture\n"
        "2. Tech Stack & Key Libraries\n"
        "3. Database Schema & Data Flow\n"
        "4. Key Features\n"
        "5. File/Directory Breakdown\n"
        "6. Potential Security or Technical Debt Issues."
    )
}

@app.post("/analyze")
async def analyze_project(
    files: Optional[List[UploadFile]] = File(None),
    level: str = Form("medium"),
    mode: str = Form("temp"),
    user_api_key: Optional[str] = Form(None),
    github_url: Optional[str] = Form(None)
):

    # --- API KEY LOGIC ---
    if user_api_key:
        genai.configure(api_key=user_api_key)
    else:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

    upload_dir = "uploaded_projects/current_scan"
    
    # Reset target directory securely
    if os.path.exists(upload_dir):
        def remove_readonly(func, path, excinfo):
            os.chmod(path, stat.S_IWRITE)
            func(path)
        shutil.rmtree(upload_dir, onerror=remove_readonly)
    os.makedirs(upload_dir, exist_ok=True)

    project_name = "Uploaded_Project"

    try:
        # CASE 1: User provided a GitHub Repository URL
        if github_url:
            print(f"Cloning repository from {github_url}...")
            try:
                git.Repo.clone_from(github_url, upload_dir, depth=1)
                clean_url = github_url.rstrip("/")
                project_name = clean_url.split("/")[-1].replace(".git", "")
            except Exception as e:
                return {"error": f"Failed to clone repository. Ensure the URL is public and valid. Details: {str(e)}"}

        # CASE 2: User uploaded a single .zip file
        elif files and len(files) == 1 and files[0].filename.endswith(".zip"):
            zip_path = os.path.join(upload_dir, files[0].filename)
            with open(zip_path, "wb") as buffer:
                shutil.copyfileobj(files[0].file, buffer)
            
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
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
        # ROBUST CLEANUP: Fixes Windows Git permission locks on .git folders
        if os.path.exists(upload_dir):
            def remove_readonly(func, path, excinfo):
                os.chmod(path, stat.S_IWRITE)
                func(path)
            shutil.rmtree(upload_dir, onerror=remove_readonly)

    # 1. Prepare Prompt
    prompt_instruction = PROMPTS.get(level, PROMPTS["medium"])
    full_prompt = f"{prompt_instruction}\n\nHere is the codebase:\n\n{codebase_text}"

    # 2. Get Waterfall Priority List
    preferred_models = MODEL_PREFERENCES.get(level, MODEL_PREFERENCES["medium"])
    
    summary = None
    used_model = None
    last_error = ""

    # 3. Waterfall Execution Loop
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

    # 4. Handle complete fallback failure
    if not summary:
        if "api key" in last_error or "authentication" in last_error or "unauthenticated" in last_error or "invalid" in last_error:
             return {"error": "Invalid API Key provided. Please check your key and try again."}
             
        summary = (
            "⚠️ **Analysis Failed:** Attempted to process your request across all fallback models, "
            "but all listed models were unavailable or exceeded quota limits."
        )
        used_model = "None"

    level_label = {"minimal": "Quick Summary", "medium": "Standard Architecture", "everything": "Deep Dive"}.get(level, "Analysis")
    formatted_project_name = f"{project_name} [{level_label}]"

    return {
        "project_name": formatted_project_name,
        "level": level,
        "mode": mode,
        "model_used": used_model,
        "summary": summary
    }