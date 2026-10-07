"""Recovery checks only; these are not the lost historical guard-suite results."""
import importlib.util
import os
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
import time
import unittest

spec = importlib.util.spec_from_file_location("recovered_offline", Path(__file__).with_name("check-next200-offline.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
CHILD = """
import os,signal,sys,time
from pathlib import Path
signal.signal(signal.SIGTERM,signal.SIG_IGN)
if os.fork()==0:
    while True:
        with Path(sys.argv[1]).open('a') as f:f.write('x');f.flush()
        time.sleep(.02)
while True:time.sleep(1)
"""


class RecoveryChecks(unittest.TestCase):
    def test_exact_recovered_sources_and_complete_new_dependency_closure(self):
        source = runner.verify_sources()
        self.assertEqual(source["base_commit"], "22548890d0fe161edf7be3943b1775c4f293d0d9")
        self.assertEqual(source["unresolved_dependencies"], [])
        self.assertIn(".github/scripts/verify-postcapture-statement-baseline.py", source["verified_files"])
        self.assertGreater(len(source["verified_files"]), 3900)
        self.assertEqual(source["verified_files"][".github/bounded-refresh-next-200/consumer-queue.json"]["sha256"],
                         "8ea15a9b5e8d24691c86cd1d2adf478c55a88c2dff0ea77a456d9c51fab23e38")

    def cleanup_case(self, interrupt):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            pulse = root / "pulse"
            previous = signal.getsignal(signal.SIGALRM)
            def stop(signum, frame):
                raise KeyboardInterrupt("synthetic interruption")
            try:
                with (root / "log").open("w") as log:
                    command = [sys.executable, "-c", CHILD, str(pulse)]
                    if interrupt:
                        signal.signal(signal.SIGALRM, stop)
                        signal.setitimer(signal.ITIMER_REAL, 0.4)
                        with self.assertRaises(KeyboardInterrupt):
                            runner.run_command(command, log, dict(os.environ), 10)
                    else:
                        self.assertEqual(runner.run_command(command, log, dict(os.environ), 0.4), 124)
                self.assertGreater(pulse.stat().st_size, 0)
                before = pulse.read_bytes()
                time.sleep(0.2)
                self.assertEqual(pulse.read_bytes(), before)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous)

    def test_timeout_stops_term_ignoring_grandchild(self):
        self.cleanup_case(False)

    def test_interruption_stops_term_ignoring_grandchild(self):
        self.cleanup_case(True)


if __name__ == "__main__":
    unittest.main()
