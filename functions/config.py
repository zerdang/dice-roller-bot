import configparser
import os

# get params from config
config = configparser.ConfigParser()
# TODO: change how to get config file
config_file = os.environ.get("APP_CONFIG", "config")
try:
    with open(config_file, encoding="utf-8") as handle:
        config.read_file(handle)
except FileNotFoundError:
    pass

def value(section, option, fallback=""):
    return os.environ.get(f"{section}_{option}".upper(), config.get(section, option, fallback=fallback))

def integer(section, option, fallback=0):
    return int(os.environ.get(f"{section}_{option}".upper(), config.get(section, option, fallback=str(fallback))))

def boolean(section, option, fallback=False):
    raw = os.environ.get(f"{section}_{option}".upper())
    return raw.lower() in {"1", "true", "yes", "on"} if raw is not None else config.getboolean(section, option, fallback=fallback)

# bot section
bot_name = value("bot", "name", "Dice Roller")
bot_version = value("bot", "version", "dev")
bot_token = value("bot", "token")
bot_shards = integer("bot", "shards", 1)
bot_prefix = value("bot", "prefix", "!")

# developer section
dev_name = value("developer", "name")
dev_link = value("developer", "link")
dev_github = value("developer", "github_link")

# community section
community_policy = value("community", "policy")
community_support = value("community", "support")

# topgg section
topgg_enable = boolean("topgg", "enable")
topgg_timer = integer("topgg", "timer", 60)
topgg_link = value("topgg", "link")
topgg_token = value("topgg", "token")

# metrics section
metrics_enable = boolean("metrics", "enable")
metrics_port = integer("metrics", "port", 8000)
metrics_python_ext = boolean("metrics", "python_ext")

# databases section
db_jokes = value("db", "jokes", "databases/jokes.db")
db_admin = value("db", "admin", "databases/admin.db")
db_user = value("db", "user", "databases/user.db")
companion_db = os.environ.get("COMPANION_DB", value("db", "companion", "databases/companion.db"))
companion_assets = os.environ.get("COMPANION_ASSETS", str(__import__("pathlib").Path(companion_db).with_name("companion-assets")))

# tabletop companion web server (all options are backwards-compatible defaults)
companion_enabled = boolean("companion", "enable")
companion_host = os.environ.get("HOST", value("companion", "host", "127.0.0.1"))
companion_port = int(os.environ.get("PORT", value("companion", "port", "8080")))
companion_public_url = os.environ.get("COMPANION_PUBLIC_URL", value("companion", "public_url", f"http://localhost:{companion_port}"))

# directories
dir_feedback = value("dir", "feedback", "feedback")
dir_jokes = value("dir", "jokes", "jokes")
dir_bugs = value("dir", "bugs", "bugs")

# logs
log_file = value("log", "file", "current.log")
