import json
import os
import logging

CONFIG_FILE = "config.json"

DEFAULT_CONFIG = {
    "language": "en",
    "theme": "System",
    "last_key": "",
    "expert_settings": {
        "header_len": "16",
        "header_sig": "5250474d56000000",
        "header_ver": "000301",
        "header_rem": "0000000000",
        "ignore_fake_header": False
    },
    "last_output_dir": ""
}

class Config:
    def __init__(self):
        self.config_path = CONFIG_FILE
        self.data = self.load_config()

    def load_config(self):
        if not os.path.exists(self.config_path):
            return DEFAULT_CONFIG.copy()
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                # Merge with default to ensure all keys exist
                config = DEFAULT_CONFIG.copy()
                self._recursive_update(config, loaded)
                return config
        except Exception as e:
            logging.error(f"Failed to load config: {e}")
            return DEFAULT_CONFIG.copy()

    def _recursive_update(self, base_dict, update_dict):
        for k, v in update_dict.items():
            if k in base_dict and isinstance(base_dict[k], dict) and isinstance(v, dict):
                self._recursive_update(base_dict[k], v)
            else:
                base_dict[k] = v

    def save(self):
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=4)
        except Exception as e:
            logging.error(f"Failed to save config: {e}")

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value

    # Helper getters/setters
    @property
    def language(self):
        return self.data.get("language", "en")

    @language.setter
    def language(self, value):
        self.data["language"] = value

    @property
    def theme(self):
        return self.data.get("theme", "System")

    @theme.setter
    def theme(self, value):
        self.data["theme"] = value
    
    @property
    def last_key(self):
        return self.data.get("last_key", "")

    @last_key.setter
    def last_key(self, value):
        self.data["last_key"] = value

    @property
    def expert_settings(self):
        return self.data.get("expert_settings", {})
    
    @expert_settings.setter
    def expert_settings(self, value):
        self.data["expert_settings"] = value

# Global instance
_config_instance = Config()

def get_config():
    return _config_instance
