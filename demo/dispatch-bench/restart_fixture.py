"""Local crash/retry fixture. SQLite worker ledger; separate synthetic actuator.

No network, battery I/O or Base interfaces. Ambiguous actions are NOT retried.
Run this file to reproduce results; --worker is the disposable child process.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import contextmanager

FAULTS = ("none", "before_intent", "before_intent_commit", "after_intent", "after_action", "after_receipt")
COMMAND = {"id": "device-1:export-1", "device": "device-1", "kwh": 2.0, "start": 10, "expires": 20}


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        yield db
    finally:
        db.close()


def initialize(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with connect(directory / "worker.sqlite") as db:
        db.execute("CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL)")
    with connect(directory / "actuator.sqlite") as db:
        db.execute("CREATE TABLE IF NOT EXISTS device (id INTEGER PRIMARY KEY, soc REAL NOT NULL, applications INTEGER NOT NULL, exported REAL NOT NULL)")
        db.execute("INSERT OR IGNORE INTO device VALUES (1,20,0,0)")


def validate(command, now, telemetry_at):
    if (not isinstance(command, dict) or set(command) != set(COMMAND)
            or not isinstance(command['id'], str) or not command['id']
            or command['device'] != 'device-1'
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                   for v in [command['kwh'], command['start'], command['expires'], now, telemetry_at])
            or not 0 < command['kwh'] <= 5 or command['start'] >= command['expires']):
        raise ValueError("Invalid command")


def checkpoint(fault, stage):
    if fault == stage:
        # Deliberate abrupt termination, bypassing cleanup and exception handlers.
        os._exit(86)


def actuator(directory, kwh):
    """Non-idempotent fake hardware, deliberately outside the worker transaction.

    Both comparison modes enforce the SAME reserve, losses and per-action limit.
    The comparison isolates durable identity/uncertainty handling.
    """
    with connect(Path(directory) / "actuator.sqlite") as db:
        db.execute("BEGIN IMMEDIATE")
        soc, applications, exported = db.execute("SELECT soc,applications,exported FROM device WHERE id=1").fetchone()
        delivered = min(kwh, max(0, (soc - 7.5) * math.sqrt(.88)))
        db.execute("UPDATE device SET soc=?,applications=?,exported=? WHERE id=1",
                   (soc - delivered / math.sqrt(.88), applications + 1, exported + delivered))
        db.execute("COMMIT")
    return delivered


def worker(directory, mode, command=None, now=12, telemetry_at=12, fault="none"):
    command = dict(COMMAND if command is None else command)
    validate(command, now, telemetry_at)
    if mode not in ("volatile", "durable") or fault not in FAULTS:
        raise ValueError("Invalid mode or fault")
    if now < command['start'] or now >= command['expires']:
        return "expired"
    if telemetry_at > now or now - telemetry_at > 1:
        return "stale"
    digest = hashlib.sha256(json.dumps(command, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    checkpoint(fault, "before_intent")
    if mode == "durable":
        with connect(Path(directory) / "worker.sqlite") as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT digest,state FROM commands WHERE id=?", (command['id'],)).fetchone()
            if existing:
                db.execute("COMMIT")
                if existing[0] != digest:
                    return "identity conflict"
                return "duplicate ignored" if existing[1] == "applied" else "reconciliation required"
            # Commit intent BEFORE touching the independent actuator. A restart
            # cannot know if this action happened, so it must not blindly repeat.
            db.execute("INSERT INTO commands VALUES (?,?,'uncertain')", (command['id'], digest))
            checkpoint(fault, "before_intent_commit")
            db.execute("COMMIT")
    if mode == "volatile":
        checkpoint(fault, "before_intent_commit")
    checkpoint(fault, "after_intent")
    actuator(directory, command['kwh'])
    checkpoint(fault, "after_action")
    if mode == "durable":
        with connect(Path(directory) / "worker.sqlite") as db:
            db.execute("UPDATE commands SET state='applied' WHERE id=? AND digest=?", (command['id'], digest))
    checkpoint(fault, "after_receipt")
    return "applied"


def launch(directory, mode, fault="none"):
    p = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker", str(directory),
                        "--mode", mode, "--fault", fault], capture_output=True, text=True, timeout=20)
    expected = 0 if fault == "none" else 86
    if p.returncode != expected:
        raise RuntimeError(f"Worker exited {p.returncode}, expected {expected}: {p.stderr}")
    return {"exit": p.returncode, "outcome": p.stdout.strip() or "process terminated"}


def snapshot(directory):
    with connect(Path(directory) / "actuator.sqlite") as db:
        soc, applications, exported = db.execute("SELECT soc,applications,exported FROM device WHERE id=1").fetchone()
    with connect(Path(directory) / "worker.sqlite") as db:
        row = db.execute("SELECT state FROM commands WHERE id=?", (COMMAND['id'],)).fetchone()
    return {"applications": applications, "exported_kwh": round(exported, 8),
            "stored_kwh": round(soc, 8), "receipt": row[0] if row else "none"}


def replay_case(fault, mode):
    with tempfile.TemporaryDirectory(prefix="megawatt-restart-") as directory:
        initialize(directory)
        first = launch(directory, mode, fault)
        retry = launch(directory, mode)
        state = snapshot(directory)
    return {"mode": mode, "first_exit": first['exit'], "retry": retry['outcome'], **state}


def report():
    cases = []
    for fault in FAULTS:
        baseline = replay_case(fault, "volatile")
        durable = replay_case(fault, "durable")
        expected_count = 0 if fault == "after_intent" else 1
        passed = durable['applications'] == expected_count and durable['stored_kwh'] >= 7.5
        if fault in ("after_intent", "after_action"):
            passed = passed and durable['retry'] == "reconciliation required"
        cases.append({"fault": fault, "baseline": baseline, "durable": durable, "passed": passed})
    return {"model": "restart-fixture-v1", "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "scope": "Actual local child-process termination; SQLite persistence; synthetic non-idempotent actuator. No real batteries.",
            "command": COMMAND, "reserve_kwh": 7.5, "initial_stored_kwh": 20, "round_trip_efficiency": .88,
            "passed": sum(c['passed'] for c in cases), "total": len(cases), "cases": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker")
    parser.add_argument("--mode", choices=("volatile", "durable"), default="durable")
    parser.add_argument("--fault", choices=FAULTS, default="none")
    args = parser.parse_args()
    if args.worker:
        print(worker(args.worker, args.mode, fault=args.fault))
    else:
        result = report()
        target = Path(__file__).with_name("restart-results.json")
        target.write_text(json.dumps(result, indent=2) + '\n', encoding="utf-8")
        print(f"{result['passed']}/{result['total']} restart cases passed. {target}")
        if result['passed'] != result['total']:
            raise SystemExit(1)
