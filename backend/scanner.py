import os

# Directories we absolutely do not want to send to the AI
IGNORE_DIRS = {
    'node_modules', '.git', 'venv', '.venv', '__pycache__', 
    'dist', 'build', '.next', 'out', '.idea', '.vscode'
}

# Massive lock files that waste AI tokens
IGNORE_FILES = {'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock'}

# Binary/Media files that can't be read as text
IGNORE_EXTS = {
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', 
    '.zip', '.exe', '.dll', '.pyc', '.mp4', '.mp3', '.ttf'
}

def process_codebase(extract_path: str) -> str:
    """
    Walks through the directory, ignores junk, and combines 
    all valid code into a single string.
    """
    codebase_text = ""
    
    # os.walk goes through every folder and file in the extracted project
    for root, dirs, files in os.walk(extract_path):
        
        # This line forces os.walk to skip our ignored directories
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        
        for file in files:
            if file in IGNORE_FILES:
                continue
                
            ext = os.path.splitext(file)[1].lower()
            if ext in IGNORE_EXTS:
                continue
                
            file_path = os.path.join(root, file)
            
            # Get the relative path (e.g., "src/App.jsx") so the AI knows the file structure
            rel_path = os.path.relpath(file_path, extract_path)
            
            try:
                # Open and read the file
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    
                # Format it beautifully for the AI
                codebase_text += f"\n\n--- Start of {rel_path} ---\n"
                codebase_text += content
                codebase_text += f"\n--- End of {rel_path} ---"
                
            except UnicodeDecodeError:
                # If we accidentally try to read a binary file we missed, skip it safely
                continue
                
    return codebase_text