import os
import re
import ast

class Language:
    def __init__(self, lang_code="en"):
        self.data = {}
        self.current_lang = lang_code
        self.available_langs = {}
        self.load_languages()
        self.set_language(lang_code)

    def load_languages(self):
        # Path to assets/languages
        # Assuming core/language.py is in core/, so up one level then assets/languages
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        lang_dir = os.path.join(base_dir, "assets", "languages")
        
        if not os.path.exists(lang_dir):
            print(f"Warning: Language directory not found at {lang_dir}")
            return

        for filename in os.listdir(lang_dir):
            if filename.endswith(".js"):
                lang_code = filename.replace(".js", "")
                content = self._parse_js_file(os.path.join(lang_dir, filename))
                if content:
                    self.available_langs[lang_code] = content

    def _parse_js_file(self, file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                raw = f.read()
            
            # Extract the object part: var x = { ... }
            match = re.search(r'=\s*({[\s\S]*?})\s*//', raw)
            if not match:
                # Try matching without trailing comment check if explicit check fails
                match = re.search(r'=\s*({[\s\S]*})', raw)
            
            if not match:
                print(f"Failed to find object in {file_path}")
                return None
            
            obj_str = match.group(1)
            
            # Cleaning for Python eval
            
            # 1. Remove comments //
            # Regex for single line comments: //.*
            # We must be careful not to remove // inside URL strings (http://, https://)
            # A simple heuristic: if // is preceded by : it's likely a URL.
            # But we can also use a robust pattern. 
            # For now, let's use negative lookbehind for ':'
            obj_str = re.sub(r'(?<!:)\/\/.*', '', obj_str)
            
            # 2. JS allows unquoted keys? The source files use quoted keys.
            # 3. Trailing commas are fine in Python dicts too mostly, but let's be safe.
            # Python's ast.literal_eval is safe but strict.
            
            # 4. Handle any JS specific oddities if any.
            # The files seem to use single quotes which is good for Python.
            # 'key': 'value',
            
            try:
                # ast.literal_eval might fail if there are JS specific constructs (like 'null', 'true', 'false' mapped differently?
                # Python: None, True, False.
                # JS: null, true, false.
                # We need to replace them.
                obj_str = obj_str.replace('null', 'None')
                obj_str = obj_str.replace('true', 'True')
                obj_str = obj_str.replace('false', 'False')
                
                data = ast.literal_eval(obj_str)
                return data
            except Exception as e:
                print(f"Error parsing content of {file_path}: {e}")
                return None

        except Exception as e:
            print(f"Error loading {file_path}: {e}")
            return None

    def set_language(self, lang_code):
        if lang_code in self.available_langs:
            self.current_lang = lang_code
            self.data = self.available_langs[lang_code]
        else:
            print(f"Language {lang_code} not found, falling back to en")
            if "en" in self.available_langs:
                 self.current_lang = "en"
                 self.data = self.available_langs["en"]

    def get(self, key, default=None):
        return self.data.get(key, default if default is not None else key)

    def format(self, key, *args):
        val = self.get(key)
        if not val:
            return key
        # JS uses {0}, {1}. Python format uses {0}, {1} too.
        try:
            return val.format(*args)
        except:
            return val

# Global instance
_lang_instance = None

def init_language(lang_code="en"):
    global _lang_instance
    _lang_instance = Language(lang_code)

def get_text(key, *args):
    if not _lang_instance:
        return key
    if args:
        return _lang_instance.format(key, *args)
    return _lang_instance.get(key)

def get_all_languages():
    if _lang_instance:
        return list(_lang_instance.available_langs.keys())
    return []

def set_current_language(lang_code):
    if _lang_instance:
        _lang_instance.set_language(lang_code)
