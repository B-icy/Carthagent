import hashlib
import importlib.util
import os
import pathlib
import subprocess
import sys
import time
import unittest
from unittest.mock import patch


PTY_AVAILABLE = False
PROBE = None
if os.name == 'posix':
    try:
        import fcntl
        import pty
        import tty
    except ImportError:
        pass
    else:
        PTY_AVAILABLE = hasattr(os, 'openpty')

if PTY_AVAILABLE:
    MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / 'tools' / 'native-terminal-semantics.py'
    SPEC = importlib.util.spec_from_file_location('native_terminal_semantics', MODULE_PATH)
    PROBE = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(PROBE)


@unittest.skipUnless(PTY_AVAILABLE, 'requires POSIX fcntl, pty, tty and os.openpty')
class DuplexTransportTests(unittest.TestCase):
    def launch(self, program):
        master, slave = pty.openpty()
        tty.setraw(slave)
        child = subprocess.Popen([sys.executable, '-u', '-c', program],
                                 stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        self.addCleanup(os.close, master)

        def stop():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)

        self.addCleanup(stop)
        return master, child

    def test_large_input_drains_output_and_preserves_every_byte(self):
        payload = b'\x1b[200~' + ('café 日本語 😀\n' * 20000).encode() + b'\x1b[201~'
        # The child deliberately fills output BEFORE consuming any input. A
        # write-only parent deadlocks once the independent PTY queues fill.
        master, child = self.launch(f'''
import hashlib, os, time
block = b'O' * 4096
for _ in range(128):
    os.write(1, block)
data = bytearray()
while len(data) < {len(payload)}:
    data.extend(os.read(0, min(4096, {len(payload)} - len(data))))
os.write(1, b'\\nDIGEST:' + hashlib.sha256(data).hexdigest().encode() + b'\\n')
time.sleep(2)
''')
        flags = fcntl.fcntl(master, fcntl.F_GETFL)
        output = bytearray()
        original_write = os.write
        counts = []
        retries = [InterruptedError(), BlockingIOError()]

        def partial_write(fd, data):
            if retries:
                raise retries.pop()
            # Force short writes independently of the kernel's queue sizing.
            count = original_write(fd, data[:997])
            counts.append(count)
            return count

        deadline = time.monotonic() + 5
        with patch.object(PROBE.os, 'write', side_effect=partial_write):
            PROBE.write_pty_input(master, payload, deadline, output.extend, child)
        self.assertEqual(fcntl.fcntl(master, fcntl.F_GETFL), flags)
        self.assertEqual(sum(counts), len(payload))
        self.assertGreater(len(counts), 1)
        self.assertIn(b'O' * 4096, output)
        expected = b'DIGEST:' + hashlib.sha256(payload).hexdigest().encode()
        while expected not in output and time.monotonic() < deadline:
            if PROBE.select.select([master], [], [], .05)[0]:
                output.extend(os.read(master, 65536))
        self.assertIn(expected, output)

    def test_unconsumed_input_times_out_and_restores_flags(self):
        master, child = self.launch('import time; time.sleep(10)')
        flags = fcntl.fcntl(master, fcntl.F_GETFL)
        started = time.monotonic()
        with self.assertRaisesRegex(TimeoutError, r'bytes written; child status=None'):
            PROBE.write_pty_input(master, b'x' * 1000000, started + .2, lambda _: None, child)
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertEqual(fcntl.fcntl(master, fcntl.F_GETFL), flags)

    def test_exited_child_fails_without_waiting_for_deadline(self):
        master, child = self.launch('pass')
        child.wait(timeout=3)
        with self.assertRaisesRegex(RuntimeError, 'exited during PTY input'):
            PROBE.write_pty_input(master, b'x', time.monotonic() + 5, lambda _: None, child)

    def test_output_callback_failure_restores_flags(self):
        master, child = self.launch("import os, time; os.write(1, b'ready'); time.sleep(10)")
        flags = fcntl.fcntl(master, fcntl.F_GETFL)

        def reject_output(_chunk):
            raise ValueError('screen rejected output')

        with self.assertRaisesRegex(ValueError, 'screen rejected output'):
            PROBE.write_pty_input(master, b'x' * 1000000, time.monotonic() + 2,
                                  reject_output, child)
        self.assertEqual(fcntl.fcntl(master, fcntl.F_GETFL), flags)

if __name__ == '__main__':
    unittest.main()
