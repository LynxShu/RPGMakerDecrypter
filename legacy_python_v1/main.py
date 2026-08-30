import argparse
import os
import sys
import logging
from core.crypto import Crypto
from core.key_finder import KeyFinder

def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler("latest.log", encoding='utf-8')
        ]
    )

def process_file(file_path: str, output_path: str, crypto: Crypto, mode: str):
    try:
        with open(file_path, 'rb') as f:
            data = f.read()

        if mode == 'decrypt':
            # Check extension to decide behavior or output extension?
            # For now, just decrypt content.
            decrypted_data = crypto.decrypt(data)
            
            # Simple extension mapping for Phase 1
            root, ext = os.path.splitext(output_path)
            if ext.lower() == '.rpgmvp':
                output_path = root + '.png'
            elif ext.lower() == '.rpgmvm':
                output_path = root + '.m4a'
            elif ext.lower() == '.rpgmvo':
                output_path = root + '.ogg'
            elif ext.lower() == '.png_':
                 output_path = root + '.png'
            elif ext.lower() == '.m4a_':
                 output_path = root + '.m4a'
            elif ext.lower() == '.ogg_':
                 output_path = root + '.ogg'

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(decrypted_data)
            logging.info(f"Decrypted: {file_path} -> {output_path}")

        elif mode == 'encrypt':
             encrypted_data = crypto.encrypt(data)
             # Basic mapping, defaulting to MV style for now
             root, ext = os.path.splitext(output_path)
             if ext.lower() == '.png':
                 output_path = root + '.rpgmvp'
             elif ext.lower() == '.m4a':
                 output_path = root + '.rpgmvm'
             elif ext.lower() == '.ogg':
                 output_path = root + '.rpgmvo'
                 
             os.makedirs(os.path.dirname(output_path), exist_ok=True)
             with open(output_path, 'wb') as f:
                f.write(encrypted_data)
             logging.info(f"Encrypted: {file_path} -> {output_path}")
             
    except Exception as e:
        logging.error(f"Failed to process {file_path}: {e}")

def main():
    setup_logging()
    parser = argparse.ArgumentParser(description="RPG Maker MV/MZ Decrypter CLI")
    
    parser.add_argument('--detect-key', metavar='DIR', help='Detect key from game directory')
    parser.add_argument('-i', '--input', help='Input file or directory')
    parser.add_argument('-o', '--output', help='Output file or directory')
    parser.add_argument('-k', '--key', help='Encryption Key (Hex)')
    parser.add_argument('--mode', choices=['decrypt', 'encrypt'], default='decrypt', help='Operation mode')
    parser.add_argument('--recursive', action='store_true', help='Recursive processing')

    args = parser.parse_args()

    # If no arguments are provided (and not just displaying help implicitly by argparse when required args are missing, 
    # but here all args are optional so we check sys.argv), launch GUI.
    # Actually argparse will parse empty args successfully since all are optional.
    # We can check if any relevant args are set.
    if len(sys.argv) == 1:
        try:
            from gui.app import App
            app = App()
            app.mainloop()
        except ImportError as e:
            logging.error(f"Failed to load GUI: {e}")
            print("GUI dependencies missing. Install them or use CLI mode.")
            parser.print_help()
        return

    if args.detect_key:
        finder = KeyFinder(args.detect_key)
        key = finder.find_key()
        if key:
            print(f"Detected Key: {key}")
        else:
            print("Key not found.")
        return

    if args.input and args.output and args.key:
        crypto = Crypto(args.key)
        
        if os.path.isfile(args.input):
            process_file(args.input, args.output, crypto, args.mode)
        elif os.path.isdir(args.input):
            input_dir = args.input
            output_dir = args.output
            
            for root, dirs, files in os.walk(input_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    
                    # Filter for relevant files
                    ext = os.path.splitext(file)[1].lower()
                    relevant_exts = {'.rpgmvp', '.rpgmvm', '.rpgmvo', '.png_', '.m4a_', '.ogg_'}
                    if args.mode == 'encrypt':
                        relevant_exts = {'.png', '.m4a', '.ogg'}

                    if ext in relevant_exts:
                         rel_path = os.path.relpath(file_path, input_dir)
                         out_path = os.path.join(output_dir, rel_path)
                         process_file(file_path, out_path, crypto, args.mode)
        else:
            logging.error("Invalid input path.")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
