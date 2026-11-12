"""Exercise deployment failures in temporary directories with mocked services.

Run with Python 3 on Linux. No live services, production paths, or data are used.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile


SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "deploy-linux.sh"
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['DEPLOY_TEST_ROOT'])
mode = os.environ['DEPLOY_TEST_MODE']
with (root / 'events.jsonl').open('a') as stream:
    print(json.dumps([name] + args), file=stream)
if name == 'install':
    filtered = []
    index = 0
    while index < len(args):
        if args[index] in ('-o', '-g'):
            index += 2
        else:
            filtered.append(args[index])
            index += 1
    os.execv('/usr/bin/install', ['install'] + filtered)
elif name == 'systemctl':
    if args[0] == 'restart' and mode == 'restart_failure' and (root / 'opt/current').resolve().name != 'old':
        sys.exit(1)
elif name == 'curl':
    sys.exit(1 if mode == 'health_failure' else 0)
elif name == 'daynest-backup':
    if args[0] == 'create':
        if mode == 'backup_failure':
            sys.exit(1)
        output = pathlib.Path(args[args.index('--output') + 1])
        output.mkdir()
        (output / 'verified-fixture').write_text('fixture')
    elif mode == 'verify_failure':
        sys.exit(1)
'''


def run_case(mode):
    with tempfile.TemporaryDirectory(prefix="daynest-deploy-test-") as directory:
        root = Path(directory)
        source = SOURCE.read_text()
        guard = "[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }"
        assert guard in source
        source = source.replace(guard, "true # Test only: all paths and service commands are isolated.")
        for before, after in {
            "/etc/systemd/system": root / "units",
            "/etc/daynest": root / "config",
            "/var/backups/daynest": root / "backups",
            "/var/lib/daynest": root / "state",
            "/opt/daynest": root / "opt",
            "/run/lock": root / "locks",
        }.items():
            source = source.replace(before, str(after))
        for name in ("units", "config", "locks", "state/data", "opt/releases/old/bin", "payload/bin", "payload/assets", "commands"):
            (root / name).mkdir(parents=True, exist_ok=True)
        commands = root / "commands"
        for name in ("getent", "chown", "systemctl", "curl", "sleep", "journalctl", "install"):
            target = commands / name
            target.write_text(STUB)
            target.chmod(0o755)
        old = root / "opt/releases/old"
        backup = old / "bin/daynest-backup"
        backup.write_text(STUB)
        backup.chmod(0o755)
        (root / "opt/current").symlink_to(old, target_is_directory=True)
        (root / "config/daynest.env").write_text("HTTP_ADDR=127.0.0.1:8080\n")
        data = root / "state/data/studyflow.json"
        data.write_text('{"preserve":"original data"}')
        original = data.read_bytes()
        for name in ("daynest", "daynest-backup"):
            (root / "payload/bin" / name).write_text("#!/bin/sh\nexit 0\n")
        (root / "payload/assets/index.html").write_text("fixture")
        script = root / "deploy.sh"
        script.write_text(source)
        env = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ["PATH"], DEPLOY_TEST_ROOT=str(root), DEPLOY_TEST_MODE=mode)
        result = subprocess.run(["bash", str(script), str(root / "payload"), "daynest-20261110T160000Z-abcdef0"], env=env, capture_output=True, text=True, timeout=30)
        events = [json.loads(line) for line in (root / "events.jsonl").read_text().splitlines()]
        assert (result.returncode == 0) == (mode == "success"), (mode, result.stderr)
        assert data.read_bytes() == original, mode
        active = (root / "opt/current").resolve()
        assert (active != old) == (mode == "success"), (mode, active)
        assert ["systemctl", "restart", "daynest.service"] in events, (mode, events)
        if mode == "success":
            assert next(i for i, event in enumerate(events) if event[:2] == ["daynest-backup", "verify"]) < next(i for i, event in enumerate(events) if event[:2] == ["systemctl", "restart"])
        print("PASS " + mode)


if __name__ == "__main__":
    for scenario in ("success", "backup_failure", "verify_failure", "restart_failure", "health_failure"):
        run_case(scenario)
