"""Keep at most five complete PICKET snapshots, none older than 30 elapsed days."""
import datetime
import pathlib
import re
import shutil
import sys


def prune(directory):
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)
    snapshots = []
    for path in pathlib.Path(directory).iterdir():
        match = re.fullmatch(r"picket-(\d{8}T\d{6}Z)-[A-Za-z0-9]{8}(?:\.partial)?", path.name)
        if not match or path.is_symlink() or not path.is_dir():
            continue
        created = datetime.datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        if created <= cutoff:
            shutil.rmtree(path)
        elif not path.name.endswith(".partial"):
            snapshots.append((created, path.stat().st_mtime_ns, path.name, path))

    # Publication time breaks ties when several deployments finish within one second.
    for _, _, _, path in sorted(snapshots, reverse=True)[5:]:
        shutil.rmtree(path)


if __name__ == "__main__":
    prune(sys.argv[1])
