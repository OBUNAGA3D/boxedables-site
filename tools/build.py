"""Build the real-site page from the claude.ai page.

    python3 tools/build.py

Reads src/customizer.html (a copy of the live claude.ai page) and writes public/index.html:
- removes the outer wrapper claude.ai adds around the page
- loads Firebase, the site settings and the bridge before the page's own code
- points share links at the real site and the music at public/music/
To bring over changes made on claude.ai: save the new page as src/customizer.html and run this again.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FB = "https://www.gstatic.com/firebasejs/10.14.1/"
HEAD = (
    f'<script src="{FB}firebase-app-compat.js"></script>\n'
    f'<script src="{FB}firebase-auth-compat.js"></script>\n'
    f'<script src="{FB}firebase-firestore-compat.js"></script>\n'
    '<script src="/firebase-config.js"></script>\n'
    '<script src="/bridge.js"></script>\n'
)

def must_sub(pattern, repl, text, what):
    new, n = re.subn(pattern, repl, text, count=1)
    if n != 1:
        sys.exit(f"build: couldn't find {what}")
    return new

src = (ROOT / "src" / "customizer.html").read_text(encoding="utf-8")

# claude.ai serves the page inside a small wrapper document; keep only the page itself
m = re.match(r"<!doctype html><html><head><meta charset=utf8>.*?<body>\s*(?=<!doctype html>)", src, re.S | re.I)
if m:
    src = src[m.end():]

src = must_sub(r"(<head>\s*)", r"\1" + HEAD.replace("\\", "\\\\"), src, "<head>")
src = must_sub(r"var SHARE_BASE = '[^']*';", "var SHARE_BASE = location.origin + location.pathname;", src, "SHARE_BASE")
src = must_sub(r"'/_blob/481f3e1b5901e221471ffb2bd68defa0'", "'/music/arcade-game.m4a'", src, "music link")
src = src.replace("Open the page in Claude to download.", "Sign in to download.")

(ROOT / "public" / "index.html").write_text(src, encoding="utf-8")
print(f"build: wrote public/index.html ({len(src) / 1e6:.2f} MB)")
