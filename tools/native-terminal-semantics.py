#!/usr/bin/env python3
"""Real PTY terminal-semantics probe for the pinned native OpenCode host.

The fixture provider is loopback-only. This intentionally tests an actual TUI
input/submit round trip, not the JavaScript key parser in isolation.
"""
import argparse
import fcntl
import errno
import http.server
import json
import os
import pty
import re
import select
import shutil
import signal
import socketserver
import struct
import subprocess
import tempfile
import termios
import threading
import time


class Provider(http.server.BaseHTTPRequestHandler):
    received = []

    def do_POST(self):
        length = int(self.headers.get('content-length', '0'))
        body = json.loads(self.rfile.read(length) or b'{}')
        self.received.append(body)
        response = {'id': 'offline-fixture', 'object': 'chat.completion', 'created': 1,
                    'model': 'fixture', 'choices': [{'index': 0,
                    'message': {'role': 'assistant', 'content': 'FIXTURE_RESPONSE_OK'},
                    'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 10,
                    'completion_tokens': 1, 'total_tokens': 11}}
        payload = json.dumps(response).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass


class Screen:
    """Small VT screen model for readiness and visible-screen assertions."""
    def __init__(self, rows=32, columns=100):
        self.rows, self.columns = rows, columns
        self.cells = [[' '] * columns for _ in range(rows)]
        self.x = self.y = 0
        self.mode = 'text'
        self.csi = ''
        self.osc_escape = False

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
                    self.mode = 'text'
                self.osc_escape = char == '\x1b'
                continue
            if self.mode == 'csi':
                if '@' <= char <= '~':
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

    def visible(self):
        return '\n'.join(''.join(row).rstrip() for row in self.cells)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', default=os.environ.get('CTG_OPENCODE_BIN'))
    parser.add_argument('--timeout', type=int, default=75)
    args = parser.parse_args()
    if not args.binary:
        parser.error('pass --binary or set CTG_OPENCODE_BIN to an owned native executable')
    binary = os.path.abspath(args.binary)
    if not os.path.isfile(binary):
        parser.error(f'native binary does not exist: {binary}')
    with open(binary, 'rb') as executable:
        if executable.read(256).startswith(b'echo "Error: @opencode/cli'):
            parser.error('native binary is the package postinstall placeholder, not an owned executable')

    server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    result = {'binary': binary, 'provider': 'loopback offline fixture', 'checks': {}}
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
        title_controls = bytearray()
        screen = Screen()
        errors = bytearray()
        start = time.monotonic()
        sent = False
        resized = False
        picker_started = False
        picker_cancelled = False
        # Text is intentionally multi-line, Unicode, and large enough to expose
        # truncation/byte-boundary bugs. It is sent only as bracketed paste.
        exact = 'native-pty: café 日本語 😀\n' + 'large-paste-λ-' * 1200 + '\nEND-PASTE-終'
        payload = exact.encode('utf8')
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
                    # Preserve actual OSC title/clipboard traffic for assertions.
                    for match in re.findall(rb'\x1b\][^\x07]*(?:\x07|\x1b\\)', chunk):
                        if match.startswith(b'\x1b]0;') or match.startswith(b'\x1b]2;'):
                            title_controls.extend(match)
                        if match.startswith(b'\x1b]52;'):
                            result['clipboardSequence'] = match[:100]
                    if b'\x1b[6n' in chunk:
                        os.write(master, b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        os.write(master, b'\x1b[?1;2c')
                elapsed = time.monotonic() - start
                visible = screen.visible().lower()
                if not picker_started and elapsed > 2 and visible.strip():
                    # Model selection is a native picker and Escape is a
                    # read-only cancellation: it cannot dispatch a prompt or
                    # change the configured model.
                    os.write(master, b'/model\r')
                    picker_started = True
                    picker_at = time.monotonic()
                if picker_started and not picker_cancelled and (
                        'select model' in visible or 'models' in visible and 'search' in visible):
                    os.write(master, b'\x1b')
                    picker_cancelled = True
                    picker_heading = ('select model' if 'select model' in visible else 'models')
                    picker_cancelled_at = time.monotonic()
                    result['checks']['pickerEscapeCancel'] = {
                        'status': 'PENDING', 'pickerObserved': True,
                        'cancelKey': 'Escape', 'providerRequestsBeforePrompt': len(Provider.received)}
                if picker_cancelled and result['checks'].get('pickerEscapeCancel', {}).get('status') == 'PENDING':
                    if time.monotonic() - picker_cancelled_at > .5:
                        still_open = picker_heading in screen.visible().lower()
                        result['checks']['pickerEscapeCancel'] = {
                            'status': 'FAIL' if still_open else 'PASS',
                            'pickerObserved': True, 'cancelKey': 'Escape',
                            'dismissed': not still_open,
                            'providerRequestsBeforePrompt': len(Provider.received)}
                if picker_started and not picker_cancelled and time.monotonic() - picker_at > 3:
                    # Escape regardless, so a command completion/menu cannot
                    # linger into the subsequent prompt entry.
                    os.write(master, b'\x1b')
                    picker_cancelled = True
                    result['checks']['pickerEscapeCancel'] = {
                        'status': 'UNSUPPORTED',
                        'reason': 'native model picker did not expose a recognizable visible heading; '
                                  'Escape was sent to dismiss any command menu',
                        'providerRequestsBeforePrompt': len(Provider.received)}
                if not sent and elapsed > 5 and screen.visible().strip():
                    # Narrow terminal stress is an actual resize on the PTY.
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 12, 40, 0, 0))
                    screen.resize(12, 40)
                    output_before_resize = len(output)
                    os.kill(child.pid, signal.SIGWINCH)
                    resized = True
                    time.sleep(.25)
                    os.write(master, b'\x1b[200~' + payload + b'\x1b[201~')
                    sent = True
                    submitted_at = time.monotonic()
                if sent and time.monotonic() - submitted_at > 1.5 and not Provider.received:
                    # The one newline in pasted text must not submit by itself.
                    os.write(master, b'\r')
                    submitted_at = time.monotonic() + 1e6
                if Provider.received:
                    break
            if not Provider.received:
                raise RuntimeError('loopback provider received no request; TUI may not have accepted prompt')
            bodies = Provider.received
            messages = bodies[-1].get('messages', [])
            received_text = '\n'.join(str(part.get('text', '')) for message in messages
                                      for part in (message.get('content', []) if isinstance(message.get('content'), list)
                                                   else [{'text': message.get('content', '')}]))
            if exact not in received_text:
                raise AssertionError(f'provider prompt differs: expected {len(exact)} chars, '
                                     f'got {len(received_text)} chars')
            result['checks']['unicodeAndLargeBracketedPaste'] = {
                'status': 'PASS', 'exactProviderText': True, 'characters': len(exact),
                'utf8Bytes': len(payload), 'providerRequests': len(bodies)}
            result['checks']['narrowLayout'] = {'status': 'PASS' if resized and child.poll() is None else 'FAIL',
                                                 'rows': 12, 'columns': 40,
                                                 'noExit': child.poll() is None,
                                                 'observedTerminalOutputBytes': len(output) - output_before_resize}
            if child.poll() is not None:
                raise AssertionError('host exited during narrow-layout probe')
            # Selection belongs to the terminal host/emulator, not app output.
            # We send a real mouse drag only if the app advertised mouse mode;
            # PTY has no clipboard-capable emulator to read back a selection.
            mouse_mode = b'\x1b[?1000h' in output or b'\x1b[?1002h' in output or b'\x1b[?1006h' in output
            if mouse_mode:
                os.write(master, b'\x1b[<0;2;2M\x1b[<32;8;2M\x1b[<0;8;2m')
            result['checks']['selectionClipboard'] = {
                'status': 'UNSUPPORTED',
                'reason': 'PTY provides no terminal-emulator selection or clipboard readback; '
                          'mouse reporting is ' + ('enabled' if mouse_mode else 'not advertised')}
            result['checks'].setdefault('pickerEscapeCancel', {
                'status': 'UNSUPPORTED',
                'reason': 'native home screen did not become interactive; no picker was opened'})
            result['checks']['terminalTitleRestoration'] = {
                'status': 'UNSUPPORTED' if not title_controls else 'OBSERVED_NOT_VERIFIED',
                'reason': 'PTY has no host-window title state to seed/read back; captured OSC title bytes '
                          'are diagnostic only', 'oscBytes': len(title_controls)}
            result['checks']['clipboardOSC52'] = {
                'status': 'UNSUPPORTED' if 'clipboardSequence' not in result else 'OBSERVED_NOT_VERIFIED',
                'reason': 'PTY does not implement an OSC 52 clipboard; selection/clipboard readback unavailable'}
            incomplete = [name for name, check in result['checks'].items()
                          if check['status'] not in ('PASS',)]
            result['status'] = 'INCOMPLETE' if incomplete else 'PASS'
            result['incompleteChecks'] = incomplete
            print(json.dumps(result, ensure_ascii=False))
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
