#!/usr/bin/env python3
"""Real PTY terminal-semantics probe for the pinned native OpenCode host.

The fixture provider is loopback-only. This intentionally tests an actual TUI
input/submit round trip, not the JavaScript key parser in isolation.
"""
import argparse
import base64
import fcntl
import errno
import hashlib
import http.server
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import subprocess
import socketserver
import struct
import tempfile
import termios
import threading
import time
from datetime import datetime, timezone


class Provider(http.server.BaseHTTPRequestHandler):
    received = []
    reply = 'FIXTURE_RESPONSE_OK'

    def do_POST(self):
        length = int(self.headers.get('content-length', '0'))
        body = json.loads(self.rfile.read(length) or b'{}')
        self.received.append(body)
        def event(delta, finish_reason=None):
            item = {'id': 'offline-fixture', 'object': 'chat.completion.chunk', 'created': 1,
                    'model': 'fixture', 'choices': [{'index': 0, 'delta': delta,
                    'finish_reason': finish_reason}]}
            return b'data: ' + json.dumps(item).encode() + b'\n\n'
        payload = (event({'role': 'assistant', 'content': self.reply}) +
                   event({}, 'stop') + b'data: [DONE]\n\n')
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('cache-control', 'no-cache')
        self.send_header('connection', 'close')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass


class Screen:
    """Small terminal host model for screen, title-stack, and OSC 52 state."""
    ORIGINAL_TITLE = 'CTG-ORIGINAL-TITLE'
    ORIGINAL_CLIPBOARD = 'CTG-SEEDED-CLIPBOARD'

    def __init__(self, rows=32, columns=100, title=ORIGINAL_TITLE, clipboard=ORIGINAL_CLIPBOARD):
        self.rows, self.columns = rows, columns
        self.cells = [[' '] * columns for _ in range(rows)]
        self.x = self.y = 0
        self.mode = 'text'
        self.csi = ''
        self.csi_sequences = []
        self.osc_escape = False
        self.osc = ''
        self.title = title
        self.title_stack = []
        self.title_history = []
        self.title_controls = []
        self.title_control_sequences = []
        self.osc_title_updates = []
        self.clipboard = clipboard
        self.clipboard_history = []
        self.clipboard_queries = []
        self.rejected_clipboard_payloads = []
        self.clipboard_readbacks = []
        self.wrapCount = 0

    def resize(self, rows, columns):
        self.rows, self.columns = rows, columns
        self.cells = [[' '] * columns for _ in range(rows)]
        self.x = min(self.x, columns - 1)
        self.y = min(self.y, rows - 1)

    def feed(self, data):
        text = data.decode('utf8', errors='replace')
        for char in text:
            if self.mode == 'osc':
                if char == '\x07' or (self.osc_escape and char == '\\'):
                    self._osc(self.osc)
                    self.osc = ''
                    self.mode = 'text'
                elif char != '\x1b':
                    self.osc += char
                self.osc_escape = char == '\x1b'
                continue
            if self.mode == 'csi':
                if '@' <= char <= '~':
                    if char == 't':
                        self.csi_sequences.append((self.csi, char))
                    self._csi(char, self.csi)
                    self.mode, self.csi = 'text', ''
                else:
                    self.csi += char
                continue
            if self.mode == 'esc':
                if char == '[':
                    self.mode, self.csi = 'csi', ''
                elif char == ']':
                    self.mode = 'osc'
                else:
                    self.mode = 'text'
                continue
            if char == '\x1b':
                self.mode = 'esc'
            elif char == '\r':
                self.x = 0
            elif char == '\n':
                self.y = min(self.y + 1, self.rows - 1)
            elif char == '\b':
                self.x = max(0, self.x - 1)
            elif char >= ' ':
                if self.x >= self.columns:
                    self.wrapCount += 1
                    self.x, self.y = 0, min(self.y + 1, self.rows - 1)
                self.cells[self.y][self.x] = char
                self.x += 1

    def _csi(self, final, params):
        values = [int(value) if value.isdigit() else 0 for value in params.lstrip('?').split(';')]
        n = values[0] if values and values[0] else 1
        if final in ('H', 'f'):
            self.y = max(0, min(self.rows - 1, (values[0] if values and values[0] else 1) - 1))
            self.x = max(0, min(self.columns - 1, (values[1] if len(values) > 1 and values[1] else 1) - 1))
        elif final == 'A': self.y = max(0, self.y - n)
        elif final == 'B': self.y = min(self.rows - 1, self.y + n)
        elif final == 'C': self.x = min(self.columns - 1, self.x + n)
        elif final == 'D': self.x = max(0, self.x - n)
        elif final == 'K': self.cells[self.y][self.x:] = [' '] * (self.columns - self.x)
        elif final == 'J' and values and values[0] == 2:
            self.cells = [[' '] * self.columns for _ in range(self.rows)]
            self.x = self.y = 0
        elif final == 't' and values:
            if values[0] == 22:
                self.title_stack.append(self.title)
                self.title_controls.append('save')
                self.title_control_sequences.append(params)
            elif values[0] == 23 and self.title_stack:
                self.title = self.title_stack.pop()
                self.title_history.append(self.title)
                self.title_controls.append('restore')
                self.title_control_sequences.append(params)

    def _osc(self, value):
        fields = value.split(';', 2)
        if len(fields) >= 2 and fields[0] in ('0', '2'):
            self.title = fields[-1]
            self.title_history.append(self.title)
            self.osc_title_updates.append({'kind': fields[0], 'title': self.title})
        elif len(fields) == 3 and fields[0] == '52':
            selection, encoded = fields[1], fields[2]
            if selection != 'c':
                self.rejected_clipboard_payloads.append({'reason': 'unsupported-selection', 'value': value})
                return
            if encoded == '?':
                self.clipboard_queries.append(selection)
                reply = f'\x1b]52;{selection};{base64.b64encode(self.clipboard.encode("utf8")).decode("ascii")}\x07'
                self.clipboard_readbacks.append(reply)
                return
            try:
                decoded = base64.b64decode(encoded, validate=True).decode('utf8')
            except (ValueError, UnicodeDecodeError) as error:
                self.rejected_clipboard_payloads.append({'reason': type(error).__name__, 'value': value})
                return
            self.clipboard = decoded
            self.clipboard_history.append(decoded)

    def query_clipboard(self):
        before = len(self.clipboard_readbacks)
        self.feed(b'\x1b]52;c;?\x07')
        if len(self.clipboard_readbacks) != before + 1:
            raise AssertionError('controlled host did not answer its OSC 52 clipboard query')
        reply = self.clipboard_readbacks[-1]
        fields = reply[2:-1].split(';', 2)
        if len(fields) != 3 or fields[:2] != ['52', 'c']:
            raise AssertionError('controlled host produced malformed OSC 52 clipboard query response')
        try:
            return base64.b64decode(fields[2], validate=True).decode('utf8')
        except (ValueError, UnicodeDecodeError) as error:
            raise AssertionError('controlled host produced invalid OSC 52 clipboard query payload') from error

    def visible(self):
        return '\n'.join(''.join(row).rstrip() for row in self.cells)


def controlled_terminal_model_fixture():
    """Self-test host state semantics; this is not physical OS clipboard proof."""
    host = Screen()
    host.feed(b'\x1b]52;c;a\x07')  # invalid base64 padding
    host.feed(b'\x1b]52;c;@@@\x07')
    host.feed(b'\x1b]52;c;/w==\x07')  # valid base64, invalid UTF-8
    rejected_before_valid = len(host.rejected_clipboard_payloads)
    if host.clipboard != Screen.ORIGINAL_CLIPBOARD or rejected_before_valid != 3:
        raise AssertionError('controlled host accepted malformed OSC 52 or modified seeded clipboard')

    expected_selection = 'SNIP'
    expected_response = 'FINAL[SNIP]END'
    for text in (expected_selection, expected_response):
        sequence = f'\x1b]52;c;{base64.b64encode(text.encode()).decode()}\x07'
        host.feed(sequence.encode())
        if host.clipboard != text:
            raise AssertionError('controlled host did not apply a valid OSC 52 clipboard write')
        if host.query_clipboard() != text:
            raise AssertionError('controlled host OSC 52 query did not read back the exact clipboard value')
    if host.clipboard_queries != ['c', 'c']:
        raise AssertionError('controlled host did not record both clipboard readback queries')

    host.feed(b'\x1b[22;0t\x1b]0;TEMP-TUI-TITLE\x07\x1b]2;ANOTHER-TUI-TITLE\x07\x1b[23;0t')
    if host.title != Screen.ORIGINAL_TITLE or host.title_history[-1] != Screen.ORIGINAL_TITLE:
        raise AssertionError('controlled host did not restore the seeded title from its title stack')
    return {
        'status': 'MODEL_SELFTEST_PASS_NOT_NATIVE_ACCEPTANCE',
        'scope': 'parser/state-model self-test only; does not launch OpenCode or exercise native PTY input',
        'nativeAcceptance': 'NOT_RUN',
        'physicalOSClipboardVerified': False,
        'seedClipboardPreservedOnInvalidPayloads': True,
        'invalidPayloadsRejected': rejected_before_valid,
        'exactSelectionRoundTrip': expected_selection,
        'exactLatestCopyRoundTrip': expected_response,
        'clipboardQueries': len(host.clipboard_queries),
        'titleRestoredFromStack': host.title,
        'titleSaveRestoreOrder': host.title_controls,
    }


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_pty_input(master, data, deadline, on_output, child):
    """Deliver every byte while draining output; never block past the phase deadline.

    PTYs have bounded queues in both directions. A blocking large paste can
    deadlock against the host's paint writes, even inside a timed outer loop.
    Restore descriptor flags on every exit so the normal read/drain paths retain
    their existing EOF handling. The caller owns child termination and fd cleanup.
    """
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    pending = memoryview(data)
    written = 0
    try:
        fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        while written < len(pending):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f'PTY input deadline exceeded: {written}/{len(pending)} bytes written; '
                                   f'child status={child.poll()}')
            if child.poll() is not None:
                raise RuntimeError(f'native host exited during PTY input: {child.returncode}; '
                                   f'{written}/{len(pending)} bytes written')
            try:
                readable, writable, _ = select.select([master], [master], [], min(.05, remaining))
                if readable:
                    try:
                        chunk = os.read(master, 65536)
                    except BlockingIOError:
                        chunk = None
                    if chunk == b'':
                        raise RuntimeError('PTY reached EOF during input')
                    if chunk:
                        on_output(chunk)
                if writable:
                    try:
                        count = os.write(master, pending[written:])
                    except BlockingIOError:
                        continue
                    if count == 0:
                        raise RuntimeError('PTY input write made no progress')
                    written += count
            except InterruptedError:
                continue
            except OSError as error:
                if error.errno == errno.EIO:
                    raise RuntimeError(f'PTY closed during input: {written}/{len(pending)} bytes written; '
                                       f'child status={child.poll()}') from error
                raise
    finally:
        fcntl.fcntl(master, fcntl.F_SETFL, flags)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', default=os.environ.get('CTG_OPENCODE_BIN'))
    parser.add_argument('--timeout', type=int, default=75)
    parser.add_argument('--host-model-only', action='store_true',
                        help='run controlled terminal-host fixture without launching OpenCode')
    parser.add_argument('--focused-host-roundtrip', action='store_true',
                        help='test short distinct selection/copy payloads and title restoration only')
    parser.add_argument('--assertion-regression-only', action='store_true',
                        help='test picker return state and rendered narrow layout without large paste')
    parser.add_argument('--picker-regression-only', action='store_true',
                        help='test Escape dismissal and restored home composer without sending a prompt')
    parser.add_argument('--artifact', help='write the JSON result to this path as well as stdout')
    args = parser.parse_args()
    if args.host_model_only:
        model_result = controlled_terminal_model_fixture()
        rendered = json.dumps(model_result, ensure_ascii=False, indent=2) + '\n'
        print(rendered, end='')
        if args.artifact:
            artifact_path = Path(args.artifact).resolve()
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            artifact_path.write_text(rendered, encoding='utf8')
        return 0
    if not args.binary:
        parser.error('pass --binary or set CTG_OPENCODE_BIN to an owned native executable')
    binary = os.path.abspath(args.binary)
    if not os.path.isfile(binary):
        parser.error(f'native binary does not exist: {binary}')
    binary = os.path.realpath(binary)
    binary_version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=20)
    if binary_version.returncode != 0 or '2.0.32' not in (binary_version.stdout + binary_version.stderr):
        parser.error(f'owned executable must identify the OpenCode 2.0.32 line; got {binary_version.stdout.strip()!r}')
    with open(binary, 'rb') as executable:
        if executable.read(256).startswith(b'echo "Error: @opencode/cli'):
            parser.error('native binary is the package postinstall placeholder, not an owned executable')

    server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    repo_root = Path(__file__).resolve().parents[1]
    source_status = subprocess.run(['git', '-C', str(repo_root), 'status', '--porcelain', '--untracked-files=no'],
                                   capture_output=True, text=True).stdout.strip()
    source_commit = subprocess.run(['git', '-C', str(repo_root), 'rev-parse', 'HEAD'],
                                   capture_output=True, text=True).stdout.strip()
    binary_sha = sha256_file(binary)
    result = {'startedAtUtc': datetime.now(timezone.utc).isoformat(),
              'case': ('focused-host-roundtrip' if args.focused_host_roundtrip else
                       'layout-regression' if args.assertion_regression_only else
                       'picker-regression' if args.picker_regression_only else 'full-native-probe'),
              'binary': binary, 'binaryResolvedPath': os.path.realpath(binary),
              'binarySha256': binary_sha, 'buildHash': binary_sha,
              'binaryVersion': (binary_version.stdout + binary_version.stderr).strip(),
              'probeSha256': sha256_file(__file__),
              'pluginSha256': sha256_file(repo_root / 'plugins' / 'carthagent' / 'src' / 'tui.tsx'),
              'sourceCommit': source_commit,
              'workingTreeDirty': bool(source_status),
              'sourceStatus': source_status,
              'sourceTreeSha256': hashlib.sha256(subprocess.run(
                  ['git', '-C', str(repo_root), 'diff', 'HEAD'], capture_output=True).stdout).hexdigest(),
              'sourceDiffDirty': subprocess.run(['git', '-C', str(repo_root), 'diff', '--quiet'],
                                                capture_output=True).returncode != 0,
              'provider': 'loopback offline fixture',
              'terminal': {'initialRows': 32, 'initialColumns': 100,
                           'resizeRows': None if args.focused_host_roundtrip or args.picker_regression_only else 12,
                           'resizeColumns': None if args.focused_host_roundtrip or args.picker_regression_only else 40,
                           'TERM': 'xterm-256color'},
              'controlledHostClipboardModel': True,
              'physicalOSClipboardVerified': False,
              'checks': {}}
    with tempfile.TemporaryDirectory(prefix='ctg-terminal-semantics-') as temp:
        root = os.path.abspath(temp)
        project = os.path.join(root, 'project')
        config = os.path.join(root, 'config', 'opencode')
        for path in [project, config, os.path.join(root, 'home'), os.path.join(root, 'data'),
                     os.path.join(root, 'state'), os.path.join(root, 'cache')]:
            os.makedirs(path, exist_ok=True)
        with open(os.path.join(config, 'opencode.json'), 'w', encoding='utf8') as handle:
            json.dump({'update': 'disable', 'model': 'ctgfixture/fixture',
                       'providers': {'ctgfixture': {'name': 'Offline Fixture',
                         'package': '@opencode/ai/providers/openai-compatible',
                         'settings': {'baseURL': f'http://127.0.0.1:{port}/v1'},
                         'models': {'fixture': {'name': 'Offline fixture', 'limit': {
                           'context': 32000, 'output': 1024}}}}}}, handle)
        env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
        env.update({'HOME': os.path.join(root, 'home'), 'TERM': 'xterm-256color',
                    'COLORTERM': 'truecolor', 'XDG_CONFIG_HOME': os.path.join(root, 'config'),
                    'XDG_DATA_HOME': os.path.join(root, 'data'), 'XDG_STATE_HOME': os.path.join(root, 'state'),
                    'XDG_CACHE_HOME': os.path.join(root, 'cache'), 'OPENCODE_DB': os.path.join(root, 'db.sqlite'),
                    'OPENCODE_CONFIG_DIR': config, 'OPENCODE_CONFIG': os.path.join(config, 'opencode.json'),
                    'OPENCODE_CONFIG_PROJECT_DISABLE': 'true'})
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 100, 0, 0))
        child = subprocess.Popen([binary, '--standalone'], cwd=project, env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        screen = Screen()
        initial_title = screen.title
        errors = bytearray()
        start = time.monotonic()
        input_deadline = start + args.timeout

        def capture_output(chunk):
            output.extend(chunk)
            screen.feed(chunk)

        def write_input(data):
            write_pty_input(master, data, input_deadline, capture_output, child)

        sent = False
        resized = False
        picker_started = False
        picker_cancelled = False
        picker_home_before = False
        picker_home_restored = False
        copy_invoked = False
        copy_confirmed = False
        selection_sent = False
        selection_confirmed = False
        selected_clipboard_count = 0
        copy_clipboard_count = 0
        auth_dismissed = False
        # Text is intentionally multi-line, Unicode, and large enough to expose
        # truncation/byte-boundary bugs. It is sent only as bracketed paste.
        regression_case = args.assertion_regression_only
        picker_only = args.picker_regression_only
        layout_only = regression_case and not picker_only
        focused_case = args.focused_host_roundtrip or regression_case or picker_only
        resize_case = layout_only or (not focused_case and not args.picker_regression_only)
        exact = ('focused-host-request' if focused_case else
                 'native-pty: café 日本語 😀\n' + 'large-paste-λ-' * 1200 + '\nEND-PASTE-終')
        fixture_response = 'FINAL[SNIP]END'
        selection_target = 'SNIP'
        payload = exact.encode('utf8')
        Provider.received.clear()
        Provider.reply = fixture_response
        try:
            while time.monotonic() - start < args.timeout:
                if child.poll() is not None:
                    raise RuntimeError(f'native host exited early: {child.returncode}; {bytes(output[-3000:])!r}')
                if select.select([master], [], [], .05)[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO and child.poll() is not None:
                            raise RuntimeError(f'native host exited {child.returncode}; '
                                               f'transcript={bytes(output[-5000:])!r}') from error
                        raise
                    output.extend(chunk)
                    screen.feed(chunk)
                    if b'\x1b[6n' in chunk:
                        write_input(b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        write_input(b'\x1b[?1;2c')
                elapsed = time.monotonic() - start
                visible = screen.visible().lower()
                visible_original = screen.visible()
                home_ready = 'shift+tab agents' in visible and 'ctrl+p commands' in visible
                onboarding_visible = ('connect opencode go' in visible or
                                      'connect an integration to' in visible or
                                      'send prompts' in visible)
                if focused_case and not auth_dismissed and onboarding_visible:
                    write_input(b'\x1b')
                    auth_dismissed = True
                    auth_dismissed_at = time.monotonic()
                if focused_case and auth_dismissed and time.monotonic() - auth_dismissed_at > .4:
                    visible = screen.visible().lower()
                    home_ready = 'shift+tab agents' in visible and 'ctrl+p commands' in visible
                if not focused_case and not picker_started and elapsed > 2 and home_ready:
                    # Ctrl+O opens OpenCode's recent sessions/projects menu.
                    # Ctrl+P is command completion on this runtime and must not
                    # be mistaken for a session picker.
                    write_input(b'\x0f')
                    picker_started = True
                    picker_home_before = home_ready
                    picker_at = time.monotonic()
                if picker_started and not picker_cancelled and (
                        'recent sessions' in visible or 'sessions and projects' in visible or
                        'select session' in visible):
                    write_input(b'\x1b')
                    picker_cancelled = True
                    picker_heading = next(heading for heading in
                                          ('recent sessions', 'sessions and projects', 'select session')
                                          if heading in visible)
                    picker_cancelled_at = time.monotonic()
                    result['checks']['pickerEscapeCancel'] = {
                        'status': 'PENDING', 'pickerObserved': True,
                        'cancelKey': 'Escape', 'providerRequestsBeforePrompt': len(Provider.received)}
                if picker_cancelled and result['checks'].get('pickerEscapeCancel', {}).get('status') == 'PENDING':
                    if time.monotonic() - picker_cancelled_at > .5:
                        still_open = picker_heading in screen.visible().lower()
                        picker_home_restored = ('shift+tab agents' in screen.visible().lower() and
                                                'ctrl+p commands' in screen.visible().lower())
                        no_provider_request = len(Provider.received) == 0
                        result['checks']['pickerEscapeCancel'] = {
                            'status': 'PASS' if picker_home_before and picker_home_restored and not still_open and no_provider_request else 'FAIL',
                            'pickerObserved': True, 'cancelKey': 'Escape',
                            'dismissed': not still_open, 'composerRestored': picker_home_restored,
                            'providerRequestsBeforePrompt': len(Provider.received),
                            'noPromptProviderRequestBeforeAcceptance': no_provider_request}
                        if picker_only:
                            break
                if picker_started and not picker_cancelled and time.monotonic() - picker_at > 3:
                    # Escape regardless, so a command completion/menu cannot
                    # linger into the subsequent prompt entry.
                    write_input(b'\x1b')
                    picker_cancelled = True
                    result['checks']['pickerEscapeCancel'] = {
                        'status': 'UNSUPPORTED',
                        'reason': 'native model picker did not expose a recognizable visible heading; '
                                  'Escape was sent to dismiss any command menu',
                        'providerRequestsBeforePrompt': len(Provider.received)}
                if not sent and not picker_only and (((not focused_case) and
                                  picker_cancelled and elapsed > 5 and home_ready) or
                                 (args.focused_host_roundtrip and elapsed > 2 and home_ready) or
                                 (layout_only and elapsed > 2 and home_ready)):
                    # Narrow terminal stress is an actual resize on the PTY.
                    if resize_case:
                        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 12, 40, 0, 0))
                        screen.resize(12, 40)
                        output_before_resize = len(output)
                        os.kill(child.pid, signal.SIGWINCH)
                        resized = True
                        time.sleep(.25)
                    write_input(b'\x1b[200~' + payload + b'\x1b[201~')
                    sent = True
                    pasted_at = time.monotonic()
                if sent and time.monotonic() - pasted_at > 1.5 and not Provider.received:
                    # Home prompt's first Enter opens a session; submit staged
                    # prompt only after the session composer is visible.
                    write_input(b'\r')
                    first_enter_at = time.monotonic()
                    pasted_at = time.monotonic() + 1e6
                if sent and not Provider.received and 'first_enter_at' in locals() and time.monotonic() - first_enter_at > .75:
                    write_input(b'\r')
                    first_enter_at = time.monotonic() + 1e6
                if Provider.received and 'provider_received_at' not in locals():
                    provider_received_at = time.monotonic()
                visible_lines = screen.visible().splitlines()
                mouse_mode = (b'\x1b[?1000h' in output or b'\x1b[?1002h' in output or
                              b'\x1b[?1006h' in output)
                # Native Markdown renders [SNIP] as SNIP in the response body;
                # the literal bracketed fixture also appears in the session
                # header, which must not be mistaken for selectable response.
                response_rows = [index for index, line in enumerate(visible_lines, 1)
                                 if ('FINAL' + selection_target + 'END' in line and
                                     1 <= index <= screen.rows - 4)]
                response_settled = ('provider_received_at' in locals() and
                                    time.monotonic() - provider_received_at > 1.0)
                if (not selection_sent and response_rows and mouse_mode and response_settled):
                    target_row = response_rows[-1]
                    target_line = visible_lines[target_row - 1]
                    # Derive terminal cells from the original VT paint stream:
                    # the simple display model strips ANSI/does not model wide cells.
                    # For the ASCII fixture response on a single row, find the last
                    # matching occurrence and use the rendered cell substring.
                    start_col = target_line.rfind(selection_target) + 1
                    end_col = start_col + len(selection_target) - 1
                    selected_text = target_line[start_col - 1:end_col]
                    selected_clipboard_count = len(screen.clipboard_history)
                    selection_coordinates = {'startColumn': start_col, 'endColumn': end_col,
                                             'row': target_row, 'screenLine': target_line,
                                             'coordinateBasis': '1-based displayed terminal cells'}
                    # Send a real SGR press, held-button drag, and release as three
                    # separate PTY events, allowing the TUI event loop to process each.
                    for event in (f'\x1b[<0;{start_col};{target_row}M',
                                  f'\x1b[<32;{end_col};{target_row}M',
                                  f'\x1b[<0;{end_col};{target_row}m'):
                        write_input(event.encode())
                        time.sleep(.12)
                    selection_sent = True
                    selection_sent_at = time.monotonic()
                response_observed = fixture_response.encode() in output
                selection_values_now = screen.clipboard_history[selected_clipboard_count:]
                selection_observed = (selection_sent and selection_confirmed and
                                      selection_values_now == [selected_text])
                if selection_observed and 'selection_readback_at_selection' not in locals():
                    selection_readback_at_selection = screen.query_clipboard()
                if (Provider.received and not copy_invoked and
                        (response_observed or (args.focused_host_roundtrip and response_settled)) and
                        selection_observed and
                        not args.assertion_regression_only):
                    copy_clipboard_count = len(screen.clipboard_history)
                    write_input(b'/copy\r')
                    copy_invoked = True
                    copy_sent_at = time.monotonic()
                if selection_sent and not selection_confirmed and time.monotonic() - selection_sent_at > .3:
                    selection_confirmed = True
                if copy_invoked and not copy_confirmed and time.monotonic() - copy_sent_at > .75:
                    copy_confirmed = True
                if Provider.received and copy_confirmed and time.monotonic() - provider_received_at > 2:
                    break
            if not Provider.received and not picker_only:
                raise RuntimeError('loopback provider received no request; TUI may not have accepted prompt; '
                                   f'pickerStarted={picker_started}, pickerCancelled={picker_cancelled}, '
                                   f'visible={screen.visible()[-1500:]!r}, transcript={bytes(output[-4000:])!r}')
            bodies = Provider.received
            if picker_only:
                result['checks']['pickerEscapeCancel'] = result['checks'].get('pickerEscapeCancel', {
                    'status': 'UNVERIFIED', 'reason': 'picker case did not complete observable Escape dismissal'})
                result['checks']['promptSubmission'] = {
                    'status': 'PASS' if not bodies and result['checks']['pickerEscapeCancel']['status'] == 'PASS' else 'FAIL',
                    'providerRequests': len(bodies),
                    'noPromptSentDuringPickerAcceptance': not bodies}
                result['checks']['narrowLayout'] = {'status': 'NOT_RUN', 'reason': 'picker-only case does not resize terminal'}
                result['checks']['focusedPromptTransport'] = {'status': 'NOT_RUN', 'reason': 'picker-only case intentionally submits no prompt'}
                result['checks']['terminalTitleRestoration'] = {'status': 'NOT_RUN', 'reason': 'picker-only case exits without title acceptance'}
                result['checks']['selectionClipboard'] = {'status': 'NOT_RUN', 'reason': 'picker-only case does not exercise selection'}
                result['checks']['clipboardOSC52'] = {'status': 'NOT_RUN', 'reason': 'picker-only case does not exercise /copy'}
                incomplete = [name for name, check in result['checks'].items()
                              if check['status'] not in ('PASS', 'NOT_RUN')]
                result['status'] = 'INCOMPLETE' if incomplete else 'PASS'
                result['incompleteChecks'] = incomplete
                rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
                print(rendered, end='')
                if args.artifact:
                    artifact_path = Path(args.artifact).resolve()
                    artifact_path.parent.mkdir(parents=True, exist_ok=True)
                    artifact_path.write_text(rendered, encoding='utf8')
                return 2 if incomplete else 0
            else:
                messages = bodies[-1].get('messages', [])
                received_text = '\n'.join(str(part.get('text', '')) for message in messages
                                          for part in (message.get('content', []) if isinstance(message.get('content'), list)
                                                       else [{'text': message.get('content', '')}]))
            if not picker_only and exact not in received_text:
                raise AssertionError(f'provider prompt differs: expected {len(exact)} chars, '
                                     f'got {len(received_text)} chars')
            matching_bodies = []
            for body in bodies:
                request_messages = body.get('messages', [])
                request_text = '\n'.join(str(part.get('text', '')) for message in request_messages
                                          for part in (message.get('content', []) if isinstance(message.get('content'), list)
                                                       else [{'text': message.get('content', '')}]))
                if any(message.get('role') == 'user' and exact in str(message.get('content', ''))
                       for message in request_messages):
                    matching_bodies.append(body)
            if not picker_only and not matching_bodies:
                details = [[(message.get('role'), len(str(message.get('content', ''))),
                             exact in str(message.get('content', '')))
                            for message in body.get('messages', [])] for body in bodies]
                raise AssertionError(f'expected exact user prompt, provider received {len(matching_bodies)} '
                                     f'matching requests (total fixture requests {len(bodies)}): {details}')
            if picker_only:
                pass
            elif focused_case:
                result['checks']['focusedPromptTransport'] = {
                    'status': 'PASS' if exact in received_text else 'FAIL',
                    'exactProviderUserMessage': exact in received_text,
                    'providerRequests': len(bodies)}
                if args.focused_host_roundtrip:
                    result['checks']['pickerEscapeCancel'] = {'status': 'NOT_RUN', 'reason': 'focused terminal-host case intentionally skips picker scenario'}
                    result['checks']['narrowLayout'] = {'status': 'NOT_RUN', 'reason': 'focused terminal-host case intentionally skips resize scenario'}
                else:
                    result['checks']['pickerEscapeCancel'] = result['checks'].get('pickerEscapeCancel', {
                        'status': 'NOT_RUN', 'reason': 'focused layout regression case does not open picker'})
                    visible_after_resize = screen.visible()
                    narrow_content = fixture_response in visible_after_resize and '┃' in visible_after_resize
                    picker_absent = not any(heading in visible_after_resize.lower()
                                            for heading in ('select model', 'models', 'search models'))
                    result['checks']['narrowLayout'] = {
                        'status': 'PASS' if resized and screen.rows == 12 and screen.columns == 40 and
                                  child.poll() is None and narrow_content and picker_absent and
                                  all(len(line) <= screen.columns for line in visible_after_resize.splitlines()) else 'UNVERIFIED',
                        'rows': screen.rows, 'columns': screen.columns, 'resizeRequested': resized,
                        'hostAlive': child.poll() is None, 'fixtureResponseVisible': fixture_response in visible_after_resize,
                        'composerVisible': '┃' in visible_after_resize, 'pickerAbsent': picker_absent,
                        'visibleRowsWithinWidth': all(len(row) <= screen.columns for row in screen.cells),
                        'visibleScreenExcerpt': visible_after_resize[-600:]}
            else:
                result['checks']['unicodeAndLargeBracketedPaste'] = {
                    'status': 'PASS' if exact in received_text else 'FAIL', 'exactProviderText': exact in received_text,
                    'characters': len(exact), 'utf8Bytes': len(payload),
                    'matchingPromptRequests': len(matching_bodies), 'totalFixtureRequests': len(bodies)}
                visible_after_resize = screen.visible()
                narrow_content = fixture_response in visible_after_resize and '┃' in visible_after_resize
                picker_absent = 'select model' not in visible_after_resize.lower()
                result['checks']['narrowLayout'] = {
                    'status': 'PASS' if resized and screen.rows == 12 and screen.columns == 40 and
                              child.poll() is None and narrow_content and picker_absent and
                              all(len(line) <= screen.columns for line in visible_after_resize.splitlines()) else 'UNVERIFIED',
                    'rows': screen.rows, 'columns': screen.columns, 'resizeRequested': resized,
                    'hostAlive': child.poll() is None, 'fixtureResponseVisible': fixture_response in visible_after_resize,
                    'composerVisible': '┃' in visible_after_resize, 'pickerAbsent': picker_absent,
                    'visibleRowsWithinWidth': all(len(row) <= screen.columns for row in screen.cells),
                    'observedTerminalOutputBytes': len(output) - output_before_resize,
                    'visibleScreenExcerpt': visible_after_resize[-600:]}
            if child.poll() is not None:
                raise AssertionError('host exited during narrow-layout probe')
            # Selection is exercised by an SGR mouse drag. Screen applies OSC
            # clipboard writes as a controlled host model, not an OS clipboard.
            mouse_mode = b'\x1b[?1000h' in output or b'\x1b[?1002h' in output or b'\x1b[?1006h' in output
            result['checks'].setdefault('pickerEscapeCancel', {
                'status': 'UNSUPPORTED',
                'reason': 'native home screen did not become interactive; no picker was opened'})
            # Ask the TUI to exit through its own quit command so screen cleanup
            # and title restoration run before inspecting final output.
            exit_deadline = time.monotonic() + 5
            input_deadline = exit_deadline
            if child.poll() is None:
                # Clear any remaining command/editor text, then request a normal
                # TUI exit. Do not use a signal as a success-path substitute.
                write_input(b'\x15/quit\r')
            second_enter_sent = False
            ctrl_c_sent = False
            exit_actions = ['ctrl-u+quit+enter']
            while child.poll() is None and time.monotonic() < exit_deadline:
                remaining = exit_deadline - time.monotonic()
                if not second_enter_sent and remaining < 4.2:
                    write_input(b'\r')
                    second_enter_sent = True
                    exit_actions.append('enter')
                elif not ctrl_c_sent and remaining < 3.3:
                    # Ctrl-C is a TUI key in raw mode and calls the normal cleanup path.
                    write_input(b'\x03')
                    ctrl_c_sent = True
                    exit_actions.append('ctrl-c')
                if select.select([master], [], [], .05)[0]:
                    try: chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO: break
                        raise
                    output.extend(chunk)
                    screen.feed(chunk)
            exit_request_sent = False
            try:
                child.wait(timeout=max(1, exit_deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                exit_request_sent = True
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=2)
            exit_code = child.returncode
            # A PTY may still contain delayed teardown writes after child exit.
            # Drain to EOF, bounded, before judging title restoration.
            drain_deadline = time.monotonic() + 1.5
            pty_eof = False
            while time.monotonic() < drain_deadline and not pty_eof:
                if not select.select([master], [], [], .05)[0]:
                    continue
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        pty_eof = True
                        break
                    raise
                if not chunk:
                    pty_eof = True
                    break
                output.extend(chunk)
                screen.feed(chunk)
            title_pushes = screen.title_controls.count('save')
            title_pops = screen.title_controls.count('restore')
            save_index = screen.title_controls.index('save') if 'save' in screen.title_controls else -1
            restore_index = screen.title_controls.index('restore') if 'restore' in screen.title_controls else -1
            title_round_trip = (title_pushes > 0 and title_pops > 0 and not screen.title_stack and
                                save_index >= 0 and restore_index > save_index and
                                screen.title == initial_title and initial_title in screen.title_history and
                                exit_code == 0 and not exit_request_sent and pty_eof)
            if restore_index >= 0:
                restored_title = screen.title_history[-1] if screen.title_history else None
                title_round_trip = title_round_trip and restored_title == initial_title
            result['checks']['terminalTitleRestoration'] = {
                'status': 'PASS' if title_round_trip else 'FAIL',
                'reason': ('Controlled terminal host restored the seeded original title after normal TUI exit' if title_round_trip else
                           'Normal exit completed, but captured terminal output did not restore the seeded title through an ordered VT title-stack round trip'),
                'controlledHostModel': True,
                'normalExitCode': exit_code,
                'exitActions': exit_actions,
                'forcedTerminationAfterExitRequestTimeout': exit_request_sent,
                'ptyDrainedToEof': pty_eof,
                'titleSaveControls': title_pushes,
                'titleRestoreControls': title_pops,
                'titleControlOrder': screen.title_controls,
                'modeledTitleStackDepth': len(screen.title_stack),
                'titleControlsObserved': screen.title_controls,
                'titleControlSequences': screen.title_control_sequences,
                'initialTitle': initial_title,
                'finalTitle': screen.title,
                'titleSequenceObserved': screen.title_history,
                'oscTitleUpdates': screen.osc_title_updates}
            selection_values = screen.clipboard_history[selected_clipboard_count:copy_clipboard_count if copy_invoked else None] if selection_sent else []
            selection_readback = locals().get('selection_readback_at_selection')
            selection_model_pass = (selection_sent and selected_text == selection_target and
                                    selection_values == [selection_target] and
                                    selection_readback == selection_target)
            result['checks']['selectionClipboard'] = {
                'status': 'PASS' if selection_model_pass else 'UNVERIFIED',
                'reason': ('Controlled host model accepted and queried OSC 52 containing only the exact selected substring; this is not physical OS clipboard proof' if selection_sent and selection_values == [selected_text] and selection_readback == selected_text
                           else 'Native selection gesture did not yield an exact selection OSC 52 update and modeled readback'),
                'mouseReporting': mouse_mode, 'mouseDragSent': selection_sent,
                'fixtureResponseInCapturedPty': fixture_response.encode() in output,
                'fixtureResponseInScreenModel': fixture_response in screen.visible(),
                'screenExcerpt': screen.visible()[-500:],
                'selectedSubstring': selected_text if selection_sent else None,
                'mouseCoordinates': selection_coordinates if selection_sent else None,
                'controlledHostClipboardUpdates': selection_values,
                'clipboardUpdateDeltaBeforeCopy': selection_values,
                'controlledHostClipboardReadback': selection_readback,
                'physicalOSClipboardVerified': False}
            copy_values = screen.clipboard_history[copy_clipboard_count:] if copy_invoked else []
            copy_readback = screen.query_clipboard() if copy_invoked and copy_values else None
            copy_model_pass = (copy_invoked and copy_values == [fixture_response] and
                               copy_readback == fixture_response)
            result['checks']['clipboardOSC52'] = {
                'status': 'PASS' if copy_model_pass else 'UNVERIFIED',
                'reason': 'Controlled host model accepted and queried OSC 52 with the exact distinct latest fixture response; this is not physical OS clipboard proof' if copy_invoked and copy_values == [fixture_response] and copy_readback == fixture_response else 'No exact new OSC 52 clipboard value and readback observed after /copy',
                'copyActionSent': copy_invoked,
                'controlledHostClipboardUpdates': copy_values,
                'clipboardUpdateDeltaAfterSelection': copy_values,
                'controlledHostClipboardReadback': copy_readback,
                'physicalOSClipboardVerified': False}
            incomplete = [name for name, check in result['checks'].items()
                          if check['status'] != 'PASS']
            result['status'] = 'INCOMPLETE' if incomplete else 'PASS'
            result['incompleteChecks'] = incomplete
            rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
            print(rendered, end='')
            if args.artifact:
                artifact_path = Path(args.artifact).resolve()
                artifact_path.parent.mkdir(parents=True, exist_ok=True)
                artifact_path.write_text(rendered, encoding='utf8')
            return 2 if incomplete else 0
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            os.close(master)
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())
