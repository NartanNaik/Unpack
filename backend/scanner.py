import os

# 1. DIRECTORIES: Ignore standard build tools PLUS Machine Learning data folders
IGNORE_DIRS = {
    'node_modules', '.git', 'venv', '.venv', '__pycache__', 'env', '.env',
    'dist', 'build', '.next', 'out', '.idea', '.vscode', '.cache',
    'data', 'datasets', 'models', 'checkpoints', 'logs', 'wandb', 'tensorboard'
}

# 2. EXACT FILES: Massive lock files and secure env files
IGNORE_FILES = {
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 
    'Cargo.lock', 'Gemfile.lock', 'composer.lock', 
    '.env', '.env.local', '.env.development', '.env.production'
}

# 3. EXTENSIONS: Ignore binary, media, and massive ML datasets/weights
IGNORE_EXTS = {
    # Media / Binary / Archives
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', 
    '.zip', '.tar', '.gz', '.exe', '.dll', '.pyc', '.mp4', '.mp3', '.ttf',
    # Machine Learning / Data (The cause of the 6-million token crash)
    '.csv', '.tsv', '.jsonl', '.parquet', '.arrow', '.sql', '.db', '.sqlite',
    '.pt', '.pth', '.h5', '.hdf5', '.bin', '.onnx', '.npy', '.npz', '.pkl', '.tfrecords'
}

# 4. SAFETY LIMITS
MAX_FILE_SIZE_BYTES = 200 * 1024     # 200 KB per file max (Blocks massive hidden JSONs)
MAX_TOTAL_CHARACTERS = 2_000_000     # ~500k tokens max total (Guarantees safe API payload)

def process_codebase(extract_path: str) -> str:
    """
    Walks through the directory, heavily filters out junk/data/models, 
    and combines all valid code safely into a single string.
    """
    codebase_text = ""
    total_chars = 0
    
    # os.walk goes through every folder and file in the extracted project
    for root, dirs, files in os.walk(extract_path):
        
        # Strip out ignored directories in-place so os.walk skips them entirely
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        
        for file in files:
            # Stop everything if we are approaching the max payload size
            if total_chars >= MAX_TOTAL_CHARACTERS:
                codebase_text += "\n\n[WARNING: MAX PAYLOAD SIZE REACHED. SCAN TERMINATED EARLY TO PROTECT API LIMITS.]"
                return codebase_text

            if file in IGNORE_FILES:
                continue
                
            ext = os.path.splitext(file)[1].lower()
            if ext in IGNORE_EXTS:
                continue
                
            file_path = os.path.join(root, file)
            
            # Check file size before opening to prevent memory crashes
            try:
                file_size = os.path.getsize(file_path)
                if file_size > MAX_FILE_SIZE_BYTES:
                    continue 
            except OSError:
                continue

            # Get the relative path (e.g., "src/App.jsx") so the AI knows the file structure
            rel_path = os.path.relpath(file_path, extract_path)
            
            try:
                # Open and read the file
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    
                # Format it beautifully for the AI
                formatted_chunk = f"\n\n--- Start of {rel_path} ---\n{content}\n--- End of {rel_path} ---"
                codebase_text += formatted_chunk
                total_chars += len(formatted_chunk)
                
            except UnicodeDecodeError:
                # If we accidentally try to read a binary file we missed, skip it safely
                continue
                
    return codebase_text