import importlib.util
import pathlib
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("operations", pathlib.Path("deploy/monitoring/exporter.py"))
operations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operations)


def container(identity, service="picket", oneoff=False):
    return {"Id": identity, "State": "running", "Labels": {
        "com.docker.compose.service": service,
        "com.docker.compose.oneoff": str(oneoff)}}


class OperationalMetadata(unittest.TestCase):
    def test_restart_counter_survives_replacements_and_ignores_oneoffs(self):
        first = [container("old")]
        inspect = lambda _id: {"State": {"Running": True, "Health": {"Status": "healthy"}}, "RestartCount": 3}
        counts, state = operations.container_metrics(first, inspect, {})
        self.assertEqual(counts["picket"], {"running": 1, "healthy": 1})
        self.assertEqual(state["totals"]["picket"], 3)
        _, unchanged = operations.container_metrics(first, inspect, state)
        self.assertEqual(unchanged["totals"]["picket"], 3)
        replacement = [container("new"), container("tool", oneoff=True)]
        inspect = lambda _id: {"State": {"Running": True}, "RestartCount": 0}
        counts, replaced = operations.container_metrics(replacement, inspect, unchanged)
        self.assertEqual(counts["picket"]["running"], 1)
        self.assertEqual(replaced["totals"]["picket"], 3)
        self.assertNotIn("old", replaced["seen"])
        self.assertNotIn("tool", replaced["seen"])

    def test_resource_measurements_aggregate_rollout_replicas_without_ids(self):
        data = {"memory_stats": {"usage": 100, "stats": {"inactive_file": 20}},
                "cpu_stats": {"cpu_usage": {"total_usage": 2_000_000_000}}}
        observed = operations.resource_metrics([container("old"), container("new"), container("private", "PRIVATE")], lambda _id: data)
        self.assertEqual(observed["picket"]["memory_bytes"], 160)
        self.assertEqual(observed["picket"]["cpu_seconds_total"], 4)
        self.assertEqual(observed["picket"]["stats_available"], 2)
        self.assertNotIn("PRIVATE", observed)
        self.assertNotIn("old", observed)

    def test_backup_metadata_excludes_partial_archives_and_never_reads_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            good = root / "picket-valid"
            good.mkdir()
            (good / "picket.dump.age").write_bytes(b"PRIVATE CONTENT NEVER EXPORTED")
            (good / "picket.dump.age.sha256").write_text("checksum")
            partial = root / "picket-unfinished.partial"
            partial.mkdir()
            (partial / "picket.dump.age").write_bytes(b"partial")
            now = int(time.time())
            (root / ".last-success").write_text(str(now))
            (root / ".failure-since").write_text("NaN")
            result = operations.backup_metrics(root)
            self.assertEqual(result["picket_backup_archives"], 1)
            self.assertEqual(result["picket_backup_last_success"], now)
            self.assertEqual(result["picket_backup_failure_since"], 0)
            self.assertNotIn("PRIVATE", str(result))
            self.assertNotIn("picket-valid", str(result))


if __name__ == "__main__":
    unittest.main()
