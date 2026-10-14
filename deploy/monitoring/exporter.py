"""Operational Docker/backup metadata only; no application data or archive contents."""
import http.client
import json
import math
import os
import pathlib
import socket
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVICES = ("picket", "picket-stats", "postgres", "traefik", "backup", "grafana",
            "prometheus", "loki", "alloy", "node-exporter",
            "postgres-exporter", "operations-exporter")
LOCK = threading.Lock()


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect("/var/run/docker.sock")


def docker_get(path):
    connection = DockerConnection("localhost", timeout=5)
    try:
        connection.request("GET", "/v1.44" + path)
        response = connection.getresponse()
        if response.status != 200:
            raise OSError("Docker metadata unavailable")
        return json.loads(response.read())
    finally:
        connection.close()


def stamp(directory, name):
    try:
        value = float((directory / name).read_text())
        return value if math.isfinite(value) and 0 <= value <= time.time() + 300 else 0
    except (OSError, ValueError):
        return 0


def backup_metrics(directory):
    # Directory entries and timestamps only. Never decrypt or read dump contents.
    archives = [item for item in directory.glob("picket-*")
                if item.is_dir() and not item.name.endswith(".partial")
                and (item / "picket.dump.age").is_file()
                and (item / "picket.dump.age.sha256").is_file()
                and (item / "picket.dump.age").stat().st_size > 0]
    result = {
        "picket_backup_archives": len(archives),
        "picket_backup_bytes": sum((item / "picket.dump.age").stat().st_size for item in archives),
        "picket_backup_last_success": stamp(directory, ".last-success"),
        "picket_backup_last_attempt": stamp(directory, ".last-attempt"),
        "picket_backup_last_failure": stamp(directory, ".last-failure"),
        "picket_backup_failure_since": stamp(directory, ".failure-since"),
        "picket_backup_duration_seconds": stamp(directory, ".last-duration"),
        "picket_restore_last_verified": stamp(directory, ".last-restore-check"),
    }
    return result


def container_metrics(containers, inspect, previous):
    counts = {name: {"running": 0, "healthy": 0} for name in SERVICES}
    counters = {name: int(previous.get("totals", {}).get(name, 0)) for name in SERVICES}
    seen = {}
    for container in containers:
        service = container.get("Labels", {}).get("com.docker.compose.service")
        # Ignore Compose one-off tools, including backups run before migrations.
        if service not in counts or container.get("Labels", {}).get("com.docker.compose.oneoff", "false").lower() == "true":
            continue
        info = inspect(container["Id"])
        state = info["State"]
        counts[service]["running"] += int(state.get("Running", False))
        counts[service]["healthy"] += int(state.get("Running", False) and state.get("Health", {}).get("Status", "healthy") == "healthy")
        current = int(info.get("RestartCount", 0))
        old = int(previous.get("seen", {}).get(container["Id"], 0))
        counters[service] += max(0, current - old)
        seen[container["Id"]] = current
    return counts, {"totals": counters, "seen": seen}


def resource_metrics(containers, stats):
    resources = {name: {"memory_bytes": 0, "cpu_seconds_total": 0, "stats_available": 0} for name in SERVICES}
    for container in containers:
        service = container.get("Labels", {}).get("com.docker.compose.service")
        if service not in resources or container.get("State") != "running" or container.get("Labels", {}).get("com.docker.compose.oneoff", "false").lower() == "true":
            continue
        data = stats(container["Id"])
        memory = data.get("memory_stats", {})
        cache = memory.get("stats", {}).get("inactive_file", memory.get("stats", {}).get("total_inactive_file", 0))
        resources[service]["memory_bytes"] += max(0, memory.get("usage", 0) - cache)
        resources[service]["cpu_seconds_total"] += data.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0) / 1e9
        resources[service]["stats_available"] += 1
    return resources


def render(backups=pathlib.Path("/backups"), state_path=pathlib.Path("/state/restarts.json")):
    lines = []

    def metric(name, value, labels="", kind="gauge"):
        # Repeating TYPE per series is invalid; callers append it separately for labeled families.
        if not labels:
            lines.append(f"# TYPE {name} {kind}")
        lines.append(f"{name}{labels} {value}")

    try:
        if not backups.is_dir():
            raise OSError("backup directory unavailable")
        for name, value in backup_metrics(backups).items():
            metric(name, value)
        metric("picket_backup_metadata_available", 1)
    except OSError:
        metric("picket_backup_metadata_available", 0)

    try:
        project = os.environ.get("PICKET_COMPOSE_PROJECT", "picket")
        query = urllib.parse.urlencode({"all": "true", "filters": json.dumps({"label": ["com.docker.compose.project=" + project]})})
        containers = docker_get("/containers/json?" + query)
        with LOCK:
            try:
                previous = json.loads(state_path.read_text())
            except (OSError, ValueError):
                previous = {}
            counts, state = container_metrics(containers, lambda identity: docker_get("/containers/" + identity + "/json"), previous)
            temporary = state_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(state))
            temporary.replace(state_path)
        for family in ("running", "healthy", "restarts_total"):
            name = "picket_container_" + family
            lines.append(f"# TYPE {name} {'counter' if family == 'restarts_total' else 'gauge'}")
            for service in SERVICES:
                value = state["totals"][service] if family == "restarts_total" else counts[service][family]
                metric(name, value, '{service="' + service + '"}')
        resources = resource_metrics(containers, lambda identity: docker_get("/containers/" + identity + "/stats?stream=false&one-shot=true"))
        for family in ("memory_bytes", "cpu_seconds_total", "stats_available"):
            name = "picket_container_" + family
            lines.append(f"# TYPE {name} {'counter' if family == 'cpu_seconds_total' else 'gauge'}")
            for service in SERVICES:
                metric(name, resources[service][family], '{service="' + service + '"}')
        metric("picket_docker_metadata_available", 1)
    except (OSError, ValueError, KeyError, http.client.HTTPException):
        metric("picket_docker_metadata_available", 0)
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/metrics":
            self.send_error(404)
            return
        body = render().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9101), Handler).serve_forever()
