from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
import zipfile
import os
import shutil
import stat
import urllib.request
from dotenv import load_dotenv
from scanner import process_codebase

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://unpack-tau.vercel.app", 
        "http://localhost:3000",
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenRouter specific model tags
MODEL_PREFERENCES = {
    "minimal": [
        "google/gemini-2.0-flash-lite-preview-02-05:free",
        "google/gemini-1.5-flash-8b"
    ],
    "medium": [
        "google/gemini-2.0-flash-lite-preview-02-05:free",
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-1.5-flash"
    ],
    "everything": [
        "google/gemini-2.0-pro-exp-02-05:free",
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-1.5-pro"
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
    # Enforce key requirement directly from the frontend
    if not user_api_key:
        return {"error": "Missing OpenRouter API Key. Please provide it in the UI."}

    # Initialize OpenRouter Client
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=user_api_key,
    )

    upload_dir = "uploaded_projects/current_scan"
    
    if os.path.exists(upload_dir):
        def remove_readonly(func, path, excinfo):
            os.chmod(path, stat.S_IWRITE)
            func(path)
        shutil.rmtree(upload_dir, onerror=remove_readonly)
    os.makedirs(upload_dir, exist_ok=True)

    project_name = "Uploaded_Project"

    try:
        if github_url:
            print(f"Downloading repository from {github_url}...")
            try:
                clean_url = github_url.rstrip("/").replace(".git", "")
                owner_repo = clean_url.split("github.com/")[-1]
                
                zip_url = f"https://api.github.com/repos/{owner_repo}/zipball"
                zip_path = os.path.join(upload_dir, "repo.zip")
                
                req = urllib.request.Request(zip_url, headers={'User-Agent': 'Mozilla/5.0'})
                
                with urllib.request.urlopen(req) as response, open(zip_path, 'wb') as out_file:
                    shutil.copyfileobj(response, out_file)
                
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(upload_dir)
                    
                os.remove(zip_path)
                project_name = owner_repo.split("/")[-1]
                
            except Exception as e:
                return {"error": f"Failed to download repository. Details: {str(e)}"}

        elif files and len(files) == 1 and files[0].filename.endswith(".zip"):
            zip_path = os.path.join(upload_dir, files[0].filename)
            with open(zip_path, "wb") as buffer:
                shutil.copyfileobj(files[0].file, buffer)
            
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(upload_dir)
                
            os.remove(zip_path)
            project_name = files[0].filename.replace(".zip", "")

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

        codebase_text = process_codebase(upload_dir)

    finally:
        if os.path.exists(upload_dir):
            def remove_readonly(func, path, excinfo):
                os.chmod(path, stat.S_IWRITE)
                func(path)
            shutil.rmtree(upload_dir, onerror=remove_readonly)

    prompt_instruction = PROMPTS.get(level, PROMPTS["medium"])
    full_prompt = f"{prompt_instruction}\n\nHere is the codebase:\n\n{codebase_text}"

    preferred_models = MODEL_PREFERENCES.get(level, MODEL_PREFERENCES["medium"])
    
    summary = None
    used_model = None
    last_error = ""

    for model_name in preferred_models:
        try:
            print(f"Attempting model: {model_name}...")
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "user", "content": full_prompt}
                ]
            )
            summary = response.choices[0].message.content
            used_model = model_name
            print(f"Success! Generated summary using model: {used_model}")
            break
        except Exception as e:
            last_error = str(e).lower()
            print(f"Model '{model_name}' failed with error: {e}. Trying next available fallback...")
            continue

    if not summary:
        if "401" in last_error or "key" in last_error or "unauthorized" in last_error:
             return {"error": "Invalid OpenRouter API Key provided. Please check your key on the site and try again."}
             
        summary = (
            f"⚠️ **Analysis Failed:** Attempted to process your request, but all fallback models failed.\nLast Error: {last_error}"
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