#!/usr/bin/env python3
"""Real PTY terminal-semantics probe for the pinned native OpenCode host.

The fixture provider is loopback-only. This intentionally tests an actual TUI
input/submit round trip, not the JavaScript key parser in isolation.
"""
import argparse
import base64
import fcntl
import errno
import http.server
import json
import os
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
    def __init__(self, rows=32, columns=100, title='CTG-ORIGINAL-TITLE'):
        self.rows, self.columns = rows, columns
        self.cells = [[' '] * columns for _ in range(rows)]
        self.x = self.y = 0
        self.mode = 'text'
        self.csi = ''
        self.osc_escape = False
        self.osc = ''
        self.title = title
        self.title_stack = []
        self.title_history = []
        self.clipboard_values = []

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
        elif final == 't' and values:
            if values[0] == 22:
                self.title_stack.append(self.title)
            elif values[0] == 23 and self.title_stack:
                self.title = self.title_stack.pop()
                self.title_history.append(self.title)

    def _osc(self, value):
        fields = value.split(';', 2)
        if len(fields) == 3 and fields[0] in ('0', '2'):
            self.title = fields[2]
            self.title_history.append(self.title)
        elif len(fields) == 3 and fields[0] == '52':
            try:
                self.clipboard_values.append(base64.b64decode(fields[2], validate=True).decode('utf8'))
            except (ValueError, UnicodeDecodeError):
                pass

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
        screen = Screen()
        errors = bytearray()
        start = time.monotonic()
        sent = False
        resized = False
        picker_started = False
        picker_cancelled = False
        copy_invoked = False
        copy_confirmed = False
        selection_sent = False
        selection_confirmed = False
        # Text is intentionally multi-line, Unicode, and large enough to expose
        # truncation/byte-boundary bugs. It is sent only as bracketed paste.
        exact = 'native-pty: café 日本語 😀\n' + 'large-paste-λ-' * 1200 + '\nEND-PASTE-終'
        fixture_response = 'FIXTURE_RESPONSE_OK'
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
                        os.write(master, b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        os.write(master, b'\x1b[?1;2c')
                elapsed = time.monotonic() - start
                visible = screen.visible().lower()
                visible_original = screen.visible()
                home_ready = 'ask anything' in visible or 'what is the tech' in visible
                if not picker_started and elapsed > 2 and home_ready:
                    # Ctrl+P opens the native model picker without selecting or
                    # submitting a prompt; Escape is a non-mutating cancel.
                    os.write(master, b'\x10')
                    picker_started = True
                    picker_at = time.monotonic()
                if picker_started and not picker_cancelled and (
                        'select model' in visible or 'model' in visible and ('search' in visible or 'provider' in visible)):
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
                if not sent and picker_cancelled and elapsed > 5 and home_ready:
                    # Narrow terminal stress is an actual resize on the PTY.
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 12, 40, 0, 0))
                    screen.resize(12, 40)
                    output_before_resize = len(output)
                    os.kill(child.pid, signal.SIGWINCH)
                    resized = True
                    time.sleep(.25)
                    os.write(master, b'\x1b[200~' + payload + b'\x1b[201~')
                    sent = True
                    pasted_at = time.monotonic()
                if sent and time.monotonic() - pasted_at > 1.5 and not Provider.received:
                    # Home prompt's first Enter opens a session; submit staged
                    # prompt only after the session composer is visible.
                    os.write(master, b'\r')
                    first_enter_at = time.monotonic()
                    pasted_at = time.monotonic() + 1e6
                if sent and not Provider.received and 'first_enter_at' in locals() and time.monotonic() - first_enter_at > .75:
                    os.write(master, b'\r')
                    first_enter_at = time.monotonic() + 1e6
                if Provider.received and 'provider_received_at' not in locals():
                    provider_received_at = time.monotonic()
                visible_lines = screen.visible().splitlines()
                if not selection_sent and fixture_response in '\n'.join(visible_lines):
                    target_row = next(index for index, line in enumerate(visible_lines, 1)
                                      if fixture_response in line)
                    target_line = visible_lines[target_row - 1]
                    start_col = target_line.index(fixture_response) + 1
                    end_col = start_col + len(fixture_response) - 1
                    os.write(master, f'\x1b[<0;{start_col};{target_row}M'.encode())
                    os.write(master, f'\x1b[<32;{end_col};{target_row}M'.encode())
                    os.write(master, f'\x1b[<0;{end_col};{target_row}m'.encode())
                    selection_sent = True
                    selection_sent_at = time.monotonic()
                    selection_clipboard_count = len(screen.clipboard_values)
                if Provider.received and selection_confirmed and fixture_response.encode() in output and not copy_invoked:
                    os.write(master, b'/copy')
                    time.sleep(.2)
                    os.write(master, b'\r')
                    copy_invoked = True
                    copy_sent_at = time.monotonic()
                if selection_sent and not selection_confirmed and time.monotonic() - selection_sent_at > .3:
                    selection_confirmed = True
                if copy_invoked and not copy_confirmed and time.monotonic() - copy_sent_at > .75:
                    os.write(master, b'\r')
                    copy_confirmed = True
                if Provider.received and copy_confirmed and time.monotonic() - provider_received_at > 2:
                    break
            if not Provider.received:
                raise RuntimeError('loopback provider received no request; TUI may not have accepted prompt; '
                                   f'pickerStarted={picker_started}, pickerCancelled={picker_cancelled}, '
                                   f'visible={screen.visible()[-1500:]!r}, transcript={bytes(output[-4000:])!r}')
            bodies = Provider.received
            messages = bodies[-1].get('messages', [])
            received_text = '\n'.join(str(part.get('text', '')) for message in messages
                                      for part in (message.get('content', []) if isinstance(message.get('content'), list)
                                                   else [{'text': message.get('content', '')}]))
            if exact not in received_text:
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
            if not matching_bodies:
                details = [[(message.get('role'), len(str(message.get('content', ''))),
                             exact in str(message.get('content', '')))
                            for message in body.get('messages', [])] for body in bodies]
                raise AssertionError(f'expected exact user prompt, provider received {len(matching_bodies)} '
                                     f'matching requests (total fixture requests {len(bodies)}): {details}')
            result['checks']['unicodeAndLargeBracketedPaste'] = {
                'status': 'PASS', 'exactProviderText': True, 'characters': len(exact),
                'utf8Bytes': len(payload), 'matchingPromptRequests': len(matching_bodies),
                'totalFixtureRequests': len(bodies)}
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
            result['checks'].setdefault('pickerEscapeCancel', {
                'status': 'UNSUPPORTED',
                'reason': 'native home screen did not become interactive; no picker was opened'})
            # Ask the TUI to exit through its own quit command so screen cleanup
            # and title restoration run before inspecting final output.
            os.write(master, b'/quit')
            time.sleep(.1)
            os.write(master, b'\r')
            exit_deadline = time.monotonic() + 5
            while child.poll() is None and time.monotonic() < exit_deadline:
                if select.select([master], [], [], .05)[0]:
                    try: chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO: break
                        raise
                    output.extend(chunk)
                    screen.feed(chunk)
            child.wait(timeout=max(1, exit_deadline - time.monotonic()))
            title_pushes = len(re.findall(rb'\x1b\[22(?:;[^t]*)?t', output))
            title_pops = len(re.findall(rb'\x1b\[23(?:;[^t]*)?t', output))
            result['checks']['terminalTitleRestoration'] = {
                'status': 'FAIL' if not title_pushes or not title_pops else 'OBSERVED_NOT_VERIFIED',
                'reason': ('Native TUI emitted title-stack controls, but PTY has no real terminal host title readback' if title_pushes and title_pops else
                           'Native OpenCode 2.0.32 emitted OSC title changes but no VT title-stack save/restore controls'),
                'titleSaveControls': title_pushes,
                'titleRestoreControls': title_pops,
                'titleSequenceObserved': screen.title_history}
            selection_values = screen.clipboard_values[selection_clipboard_count:] if selection_sent else []
            result['checks']['selectionClipboard'] = {
                'status': 'OBSERVED_NOT_VERIFIED' if selection_sent and any(fixture_response in value for value in selection_values) else 'FAIL',
                'reason': ('A real SGR mouse drag emitted OSC 52 containing the selected text; PTY cannot read actual terminal clipboard state' if selection_sent and selection_values
                           else 'Mouse drag did not produce an observable selection clipboard OSC 52'),
                'mouseReporting': mouse_mode, 'mouseDragSent': selection_sent,
                'decodedSelectionPayloads': selection_values}
            decoded_clipboards = screen.clipboard_values
            result['checks']['clipboardOSC52'] = {
                'status': 'OBSERVED_NOT_VERIFIED' if copy_invoked and fixture_response in decoded_clipboards else 'FAIL',
                'reason': 'Native /copy emitted OSC 52 with the exact fixture assistant response; PTY cannot verify actual clipboard readback' if copy_invoked and fixture_response in decoded_clipboards else 'No matching OSC 52 clipboard value observed after /copy',
                'copyActionSent': copy_invoked,
                'decodedClipboardValues': decoded_clipboards,
                'sequences': len(decoded_clipboards)}
            incomplete = [name for name, check in result['checks'].items()
                          if check['status'] != 'PASS']
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
