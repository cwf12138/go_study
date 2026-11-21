"""Install Daynest meal AI settings for one existing account. Run with sudo on the server."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_provider(api_key):
    body = json.dumps({
        "model": "glm-4.5-flash",
        "messages": [{"role": "user", "content": "Reply with one short food name."}],
        "stream": False,
        "max_tokens": 128,
    }).encode("ascii")
    request = Request(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with build_opener(NoRedirect()).open(request, timeout=20) as response:
            result = json.loads(response.read(65536))
            if not result["choices"][0]["message"]["content"]:
                raise ValueError("No model output")
    except HTTPError as error:
        raise SystemExit(f"BigModel setup check failed (HTTP {error.code}); settings were not updated.")
    except (URLError, TimeoutError, ValueError, IndexError, KeyError, TypeError):
        raise SystemExit("BigModel setup check could not complete; settings were not updated.")
    print("BigModel replied successfully from the cloud server.")


def read_settings(automated):
    if automated:
        print("DAYNEST_READY_FOR_MEAL_AI_SETTINGS", flush=True)
        raw = sys.stdin.readline(2048)
        try:
            settings = json.loads(raw)
            return settings["email"].strip().casefold(), settings["api_key"].strip()
        except (AttributeError, KeyError, TypeError, ValueError):
            raise SystemExit("Invalid meal AI configuration input.")

    try:
        terminal = os.open("/dev/tty", os.O_RDWR)
        os.close(terminal)
    except OSError:
        raise SystemExit("Run this setup in an interactive SSH terminal.")
    email = getpass.getpass("Daynest account email (input hidden): ").strip().casefold()
    api_key = getpass.getpass("BigModel API key (Enter keeps the existing key): ").strip()
    return email, api_key


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdin", action="store_true", help="Read one JSON settings line over an authorized SSH connection.")
    options = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run this setup with sudo on the Daynest server.")

    accounts = json.loads(Path("/var/lib/daynest/data/studyflow.json").read_text(encoding="utf-8"))["users"]
    email, api_key = read_settings(options.stdin)
    matches = [row["id"] for row in accounts if row["email"].strip().casefold() == email]
    if len(matches) != 1 or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", matches[0]):
        raise SystemExit("The account was not found in the saved Daynest data.")

    path = Path("/etc/daynest/meal-ai.env")
    if not api_key and path.is_file():
        saved = re.search(r"^BIGMODEL_API_KEY=([A-Za-z0-9_.-]+)$", path.read_text(encoding="ascii"), re.MULTILINE)
        api_key = saved[1] if saved else ""
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,512}", api_key):
        raise SystemExit("Enter a complete BigModel API key.")
    check_provider(api_key)

    with tempfile.NamedTemporaryFile(mode="w", encoding="ascii", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(f"BIGMODEL_API_KEY={api_key}\nBIGMODEL_REMOTE_OWNER_ID={matches[0]}\n")
            stream.flush()
            os.fsync(stream.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    print("Saved root-only meal AI settings for the selected account.")


if __name__ == "__main__":
    main()
