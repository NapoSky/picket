"""Daily backup at 03:30 Europe/Paris, with catch-up after downtime and retry on failure."""
import datetime
import os
import pathlib
import subprocess
import time
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("Europe/Paris")


def next_run(now):
    target = datetime.datetime.combine(now.date(), datetime.time(3, 30), ZONE)
    if now >= target:
        target += datetime.timedelta(days=1)
    return target


def schedule():
    subprocess.run(["./run.sh", "prune"], check=True)
    last = pathlib.Path(os.environ.get("BACKUP_DIR", "/backups")) / ".last-success"
    try:
        overdue = time.time() - float(last.read_text()) >= 24 * 60 * 60
    except (OSError, ValueError):
        overdue = True
    due = time.time() if overdue else next_run(datetime.datetime.now(ZONE)).timestamp()
    while True:
        time.sleep(max(0, due - time.time()))
        result = subprocess.run(["./run.sh", "daily"])
        if result.returncode:
            print("PICKET backup failed; retry in 15 minutes", flush=True)
            due = time.time() + 15 * 60
        else:
            due = next_run(datetime.datetime.now(ZONE)).timestamp()


if __name__ == "__main__":
    schedule()
