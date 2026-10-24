import ast
import hashlib
import importlib.util
import os
import pathlib
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch


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
    def assert_flags_restored(self, master, flags):
        restored = fcntl.fcntl(master, fcntl.F_GETFL)
        # XNU fcntl.h: FWASWRITTEN (0x10000) records successful writes;
        # sys_generic.c sets it, and kern_descrip.c F_SETFL preserves it
        # outside FCNTLFLAGS. It is not O_LARGEFILE or a controllable flag.
        # Compare every other bit, including access mode and O_NONBLOCK.
        kernel_write_history = 0x10000 if sys.platform == 'darwin' else 0
        self.assertEqual(restored & ~kernel_write_history, flags & ~kernel_write_history)
        self.assertEqual(os.get_blocking(master), not bool(flags & os.O_NONBLOCK))

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
        self.assert_flags_restored(master, flags)
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
        self.assert_flags_restored(master, flags)

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
        self.assert_flags_restored(master, flags)

    def test_initially_nonblocking_descriptor_stays_nonblocking(self):
        master, child = self.launch('import time; time.sleep(10)')
        os.set_blocking(master, False)
        flags = fcntl.fcntl(master, fcntl.F_GETFL)
        PROBE.write_pty_input(master, b'x', time.monotonic() + 2, lambda _: None, child)
        self.assert_flags_restored(master, flags)


@unittest.skipUnless(PTY_AVAILABLE, 'requires POSIX probe imports')
class SnapshotTests(unittest.TestCase):
    def test_utf8_sync_and_queries_survive_every_chunk_boundary(self):
        payload = b'\x1b[?2026h' + 'café 日本語 😀'.encode() + b'\x1b[6n\x1b[c\x1b[?2026l'
        for boundary in range(len(payload) + 1):
            with self.subTest(boundary=boundary):
                screen = PROBE.Screen()
                screen.feed(payload[:boundary])
                screen.feed(payload[boundary:])
                self.assertFalse(screen.sync_open)
                self.assertEqual(screen.mode, 'text')
                self.assertIn('café 日本語 😀', screen.visible())
                self.assertEqual(screen.queries, [b'\x1b[1;1R', b'\x1b[?1;2c'])

    def test_backlogged_paint_is_consumed_and_all_queries_answered_before_snapshot(self):
        screen = PROBE.Screen()
        screen.feed(b'\x1b[?2026hSearch sessions and projects\x1b[6')
        chunks = [b'n\x1b[', b'c\x1b[2Jshift+tab agents  ctrl+p commands\x1b[?2026', b'l']
        child = Mock(returncode=None)
        child.poll.return_value = None
        replies = []
        # select times out once mid-frame: no partial snapshot may escape.
        with patch.object(PROBE.select, 'select', side_effect=[([], [], []),
                          ([123], [], []), ([123], [], []), ([123], [], []), ([], [], [])]), \
             patch.object(PROBE.os, 'read', side_effect=chunks):
            PROBE.drain_terminal_snapshot(123, screen, time.monotonic() + 2,
                                          screen.feed, replies.append, child)
        self.assertFalse(screen.sync_open)
        self.assertNotIn('sessions and projects', screen.visible())
        self.assertIn('ctrl+p commands', screen.visible())
        self.assertEqual(replies, [b'\x1b[1;1R', b'\x1b[?1;2c'])
        self.assertEqual(screen.queries, [])

    def test_unfinished_frame_and_continuous_backlog_obey_existing_deadline(self):
        for incomplete in (False, True):
            with self.subTest(incomplete=incomplete):
                screen = PROBE.Screen()
                if incomplete:
                    screen.feed(b'\x1b[?2026h')
                child = Mock(returncode=None)
                child.poll.return_value = None
                with patch.object(PROBE.time, 'monotonic', side_effect=[1, 2, 3]), \
                     patch.object(PROBE.select, 'select', return_value=([123], [], [])), \
                     patch.object(PROBE.os, 'read', return_value=b'x'):
                    with self.assertRaisesRegex(TimeoutError, 'existing input deadline'):
                        PROBE.drain_terminal_snapshot(123, screen, 3, screen.feed, Mock(), child)


@unittest.skipUnless(PTY_AVAILABLE, 'requires POSIX probe imports')
class PickerSequencingTests(unittest.TestCase):
    def test_pending_acceptance_prevents_resize_and_paste_with_stale_home_footer(self):
        # Execute the actual prompt phase from main, not a duplicate predicate.
        # A slow startup (>5s) leaves the home footer visible behind the picker
        # in the same iteration that Escape marks its acceptance PENDING.
        tree = ast.parse(MODULE_PATH.read_text(encoding='utf8'))
        phases = [node for node in ast.walk(tree) if isinstance(node, ast.If) and
                  isinstance(node.test, ast.BoolOp) and
                  [ast.unparse(value) for value in node.test.values[:2]] ==
                  ['not sent', 'not picker_only']]
        self.assertEqual(len(phases), 1)
        phase = compile(ast.Module(body=phases, type_ignores=[]), str(MODULE_PATH), 'exec')
        for status in ('PENDING', 'PASS', 'FAIL', 'UNSUPPORTED'):
            with self.subTest(status=status):
                screen = PROBE.Screen()
                screen.feed(b'shift+tab agents  ctrl+p commands')
                payload = ('native-pty: café 日本語 😀\n' + 'large-paste-λ-' * 1200 +
                           '\nEND-PASTE-終').encode('utf8')
                write_input = Mock()
                namespace = dict(sent=False, picker_only=False, focused_case=False,
                                 picker_cancelled=True, elapsed=6, home_ready=True,
                                 result={'checks': {'pickerEscapeCancel': {'status': status}}},
                                 args=Mock(focused_host_roundtrip=False), layout_only=False,
                                 resize_case=True, screen=screen, output=bytearray(),
                                 master=123, child=Mock(pid=456), payload=payload,
                                 write_input=write_input, fcntl=Mock(), termios=PROBE.termios,
                                 struct=PROBE.struct, os=Mock(), signal=PROBE.signal,
                                 time=Mock())
                exec(phase, namespace)
                if status == 'PENDING':
                    namespace['fcntl'].ioctl.assert_not_called()
                    namespace['os'].kill.assert_not_called()
                    write_input.assert_not_called()
                    self.assertEqual((screen.rows, screen.columns), (32, 100))
                    self.assertIn('ctrl+p commands', screen.visible())
                    self.assertFalse(namespace['sent'])
                else:
                    namespace['fcntl'].ioctl.assert_called_once()
                    namespace['os'].kill.assert_called_once_with(456, PROBE.signal.SIGWINCH)
                    write_input.assert_called_once_with(b'\x1b[200~' + payload + b'\x1b[201~')
                    self.assertEqual(len(payload), 18047)
                    self.assertEqual((screen.rows, screen.columns), (12, 40))
                    self.assertTrue(namespace['sent'])
                self.assertEqual(namespace['result']['checks']['pickerEscapeCancel']['status'], status)

if __name__ == '__main__':
    unittest.main()
