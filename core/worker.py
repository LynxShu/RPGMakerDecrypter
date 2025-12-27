import threading
import os
import time
import logging
from typing import List, Dict, Callable
from .crypto import Crypto
from core.language import get_text

class WorkerThread(threading.Thread):
    def __init__(self, 
                 files: List[Dict], 
                 mode: str, 
                 crypto: Crypto, 
                 output_dir: str, 
                 progress_callback: Callable[[int, int, str, float, float], None],
                 log_callback: Callable[[str], None],
                 finished_callback: Callable[[bool, str], None],
                 target_version: str = "mv"):
        
        super().__init__()
        self.files = files
        self.mode = mode
        self.crypto = crypto
        self.output_dir = output_dir
        self.progress_callback = progress_callback
        self.log_callback = log_callback
        self.finished_callback = finished_callback
        self.target_version = target_version.lower()
        
        self._stop_event = threading.Event()
        self.logger = logging.getLogger("Worker")

    def stop(self):
        self._stop_event.set()

    def run(self):
        mode_str = get_text(f"mode.{self.mode}")
        self.log_callback(get_text("log.starting", mode_str, len(self.files)))
        
        if not os.path.exists(self.output_dir):
            try:
                os.makedirs(self.output_dir)
            except OSError as e:
                self.finished_callback(False, get_text("log.outputDirError", str(e)))
                return

        total_files = len(self.files)
        processed_count = 0
        processed_bytes = 0
        success_count = 0
        start_time = time.time()
        
        # Determine common prefix to preserve structure
        # Simple heuristic: use the directory of the first file as base?
        # Or just flatten if not sure.
        # Better: For each file, if it's inside a 'img' or 'audio' folder, try to keep that structure.
        
        for file_info in self.files:
            if self._stop_event.is_set():
                self.log_callback(get_text("log.cancelled"))
                break
                
            input_path = file_info['path']
            
            try:
                # 1. Determine Output Path
                # Strategy: If path contains "img" or "audio", start relative path from there.
                # Else, just use filename.
                rel_path = self._get_relative_path(input_path)
                
                # Determine extension change
                filename = os.path.basename(rel_path)
                file_dir = os.path.dirname(rel_path)
                
                name_root, ext = os.path.splitext(filename)
                new_ext = ext
                
                if self.mode == "decrypt" or self.mode == "restore":
                    if ext == ".rpgmvp": new_ext = ".png"
                    elif ext == ".rpgmvm": new_ext = ".m4a"
                    elif ext == ".rpgmvo": new_ext = ".ogg"
                    elif ext == ".png_": new_ext = ".png"
                    elif ext == ".m4a_": new_ext = ".m4a"
                    elif ext == ".ogg_": new_ext = ".ogg"
                
                elif self.mode == "encrypt":
                    if self.target_version == "mz":
                        if ext == ".png": new_ext = ".png_"
                        elif ext == ".m4a": new_ext = ".m4a_"
                        elif ext == ".ogg": new_ext = ".ogg_"
                    else: # mv
                        if ext == ".png": new_ext = ".rpgmvp"
                        elif ext == ".m4a": new_ext = ".rpgmvm"
                        elif ext == ".ogg": new_ext = ".rpgmvo"
                
                output_subdir = os.path.join(self.output_dir, file_dir)
                if not os.path.exists(output_subdir):
                    os.makedirs(output_subdir, exist_ok=True)
                    
                output_path = os.path.join(output_subdir, name_root + new_ext)
                
                # 2. Process
                file_size = os.path.getsize(input_path)
                processed_bytes += file_size

                with open(input_path, "rb") as f_in, open(output_path, "wb") as f_out:
                    if self.mode == "decrypt":
                        self.crypto.decrypt_stream(f_in, f_out)
                    elif self.mode == "restore":
                        self.crypto.restore_png_header_stream(f_in, f_out)
                    elif self.mode == "encrypt":
                        self.crypto.encrypt_stream(f_in, f_out) 
                    else:
                        raise ValueError(f"Unknown mode: {self.mode}")
                    
                success_count += 1
                self.log_callback(get_text("log.success", filename, os.path.basename(output_path)))
                
            except Exception as e:
                self.log_callback(get_text("log.processError", os.path.basename(input_path), str(e)))
            
            # 3. Update Progress
            processed_count += 1
            elapsed = time.time() - start_time
            
            speed_mbps = 0.0
            if elapsed > 0:
                speed_mbps = (processed_bytes / (1024 * 1024)) / elapsed

            progress = processed_count / total_files
            self.progress_callback(processed_count, total_files, f"{int(progress*100)}%", speed_mbps, elapsed)

        total_time = time.time() - start_time
        self.finished_callback(True, get_text("log.finished", processed_count, success_count, f"{total_time:.2f}"))

    def _get_relative_path(self, path: str) -> str:
        """
        Tries to find a meaningful relative path (starting from 'img', 'audio', 'movies').
        Otherwise returns just the filename.
        """
        parts = path.replace('\\', '/').split('/')
        keywords = ['img', 'audio', 'movies', 'fonts']
        
        start_index = -1
        for i, part in enumerate(parts):
            if part in keywords:
                start_index = i
                break
        
        if start_index != -1:
            return os.path.join(*parts[start_index:])
        else:
            return os.path.basename(path)
