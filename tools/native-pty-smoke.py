#!/usr/bin/env python3
"""Exercise a native CTG plugin command in a disposable real terminal host."""
import argparse
import fcntl
import json
import os
import pathlib
import pty
from contextlib import nullcontext
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time


def resolve_binary(value):
    """Resolve an explicit developer path; defaults come from the runtime selector in JS."""
    if value and (os.path.isabs(value) or os.sep in value or (os.altsep and os.altsep in value)):
        candidate = pathlib.Path(value).expanduser().resolve()
        return str(candidate) if candidate.is_file() else None
    if value:
        found = shutil.which(value)
        if found:
            return str(pathlib.Path(found).resolve())
    if value in (None, '', 'opencode'):
        return None
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, help='Binary selected and validated by lib/opencode/runtime.mjs')
    parser.add_argument('--node-executable', required=True, help='Trusted Node runtime selected by the native launcher contract')
    parser.add_argument('--plugin', default=str(pathlib.Path(__file__).resolve().parents[1] / 'plugins/carthagent'))
    parser.add_argument('--command', default='/ctg-status')
    parser.add_argument('--command-args', help='Type slash-command arguments after selecting the command suggestion')
    parser.add_argument('--after-command', action='append', help='Submit another command after expected output; may be repeated')
    parser.add_argument('--after-expect', action='append', help='Expected output for each additional command')
    parser.add_argument('--expect', default='OpenCode 2.0.32')
    parser.add_argument('--expect-color', help='Require a truecolor ANSI RGB sequence after the command, e.g. 230,196,128')
    parser.add_argument('--initial-theme', help='Select a provisioned native theme before launching the TUI')
    parser.add_argument('--expect-theme', help='Require this native theme to be persisted after command submission')
    parser.add_argument('--state-dir', help='Reuse an isolated profile directory across native process restarts')
    parser.add_argument('--reuse-state', action='store_true', help='Use an existing --state-dir without reprovisioning or rewriting theme config')
    parser.add_argument('--expect-startup-color', action='store_true', help='Require the expected RGB accent in the initial render before typing')
    parser.add_argument('--write-initial-theme', action='store_true', help='Write --initial-theme to the isolated profile before startup')
    parser.add_argument('--ready', help='Wait for this marker before typing')
    parser.add_argument('--confirm', action='store_true', help='Wait for command submission and confirmation handling to settle')
    parser.add_argument('--second-enter', action='store_true', help='Wait for command submission and confirmation handling to settle')
    parser.add_argument('--post-submit-marker', help='Require an additional unique marker after submission')
    args = parser.parse_args()
    args.binary = resolve_binary(args.binary)
    if not args.binary:
        parser.error('Selected OpenCode binary does not exist; resolve it through the native runtime selector first')
    state = pathlib.Path(args.state_dir) if args.state_dir else None
    temp_context = nullcontext(str(state)) if state else tempfile.TemporaryDirectory(prefix='ctg-pty-')
    with temp_context as temp:
        root = pathlib.Path(temp)
        for name in ['home', 'project', 'config/opencode', 'data', 'state', 'cache']:
            (root / name).mkdir(parents=True, exist_ok=True)
        # Mirror the launcher contract: custom themes are installed before the
        # native TUI scans its profile. Installing from inside the running TUI
        # cannot make a newly-created theme selectable in that same process.
        provisioner = pathlib.Path(args.plugin).resolve() / 'src/ui/theme-provision.mjs'
        if not args.reuse_state:
            (root / 'config/opencode/opencode.json').write_text(json.dumps({
                'plugins': [str(pathlib.Path(args.plugin).resolve())], 'update': 'disable',
            }))
            subprocess.run([
                'node', '--input-type=module', '-e',
                "const { provisionDefaultNativeTheme } = await import(process.argv[1]); await provisionDefaultNativeTheme(process.argv[2]);",
                str(provisioner), str(root / 'config/opencode'),
            ], check=True)
            if args.initial_theme and args.write_initial_theme:
                (root / 'config/opencode/cli.json').write_text(json.dumps({'theme': {'name': args.initial_theme}}))
        cli_config_path = root / 'config/opencode/cli.json'
        initial_config = json.loads(cli_config_path.read_text()) if cli_config_path.exists() else {}
        if args.expect_theme:
            if args.reuse_state:
                expected_persisted_config = initial_config
            else:
                (root / 'config/opencode/cli.json').write_text(json.dumps({'theme': {'name': args.expect_theme}}))
                expected_persisted_config = json.loads((root / 'config/opencode/cli.json').read_text())
                if initial_config:
                    cli_config_path.write_text(json.dumps(initial_config))
                else:
                    cli_config_path.unlink(missing_ok=True)
        else:
            expected_persisted_config = None
        env = {key: os.environ[key] for key in ['PATH', 'LANG', 'LC_ALL'] if key in os.environ}
        node_binary = pathlib.Path(args.node_executable).resolve()
        if not node_binary.is_file():
            parser.error(f'Trusted Node executable does not exist: {node_binary}')
        env['CTG_NODE_EXECUTABLE'] = str(node_binary)
        env.update({
            'HOME': str(root / 'home'), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
            'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
            'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
            'OPENCODE_CONFIG_DIR': str(root / 'config/opencode'),
            'OPENCODE_DB': str(root / 'database.sqlite'),
            'OPENCODE_CONFIG_PROJECT_DISABLE': 'true',
        })
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
        child = subprocess.Popen([args.binary, '--standalone'], cwd=root / 'project', env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        transcript = bytearray()
        started = time.monotonic()
        sent = False
        sent_at = None
        selected_at = None
        submitted = False
        confirmation_complete = False
        submission_at = None
        enter_count = 0
        after_index = 0
        after_typed_at = None
        pre_submit_transcript = None
        try:
            while time.monotonic() - started < 30:
                if child.poll() is not None:
                    raise RuntimeError(f'Native TUI exited early: {child.returncode}')
                if select.select([master], [], [], 0.1)[0]:
                    chunk = os.read(master, 65536)
                    output.extend(chunk)
                    transcript.extend(chunk)
                    # Terminal capability requests need replies on a headless PTY.
                    if b'\x1b[6n' in chunk:
                        os.write(master, b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        os.write(master, b'\x1b[?1;2c')
                ready = args.ready.encode() in transcript if args.ready else time.monotonic() - started > 8
                if not sent and ready:
                    pre_submit_transcript = bytes(transcript)
                    output.clear()
                    sent_at = time.monotonic()
                    os.write(master, args.command.encode())
                    sent = True
                if sent and not submitted and after_index == 0 and time.monotonic() - sent_at > 1:
                    # Accept the command suggestion using its natural Enter.
                    output.clear()
                    os.write(master, b'\r')
                    enter_count += 1
                    if args.command_args:
                        # Select the registered command, then type arguments
                        # into its argument composer before submitting.
                        time.sleep(0.15)
                        os.write(master, args.command_args.encode())
                    sent = False
                    sent_at = None
                    selected_at = time.monotonic()
                    continue
                if enter_count == 1 and after_index == 0 and not submitted and time.monotonic() - selected_at > 0.5:
                    # The first Enter selects the host autocomplete entry. A
                    # second natural Enter submits that selected slash command.
                    os.write(master, b'\r')
                    enter_count += 1
                    submitted = True
                    submission_at = time.monotonic()
                confirmation_prompt = re.search(rb'(?i)(?:are you sure|confirm\?|\[y/n\]|\(y/n\)|press enter to confirm)', output)
                if submitted and submission_at is not None and not confirmation_complete:
                    if confirmation_prompt:
                        # A second Enter must never be speculative. Keep the
                        # test blocked until an explicit confirmation UI is
                        # handled by a purpose-built confirmation action.
                        raise RuntimeError('Command opened a confirmation prompt; no explicit confirmation handler is configured')
                    if time.monotonic() - submission_at > 2:
                        confirmation_complete = True
                after_commands = args.after_command or []
                after_expects = args.after_expect or []
                if len(after_commands) != len(after_expects):
                    raise ValueError('--after-command and --after-expect must be supplied in matching counts')
                expected_output = args.expect if after_index == 0 else after_expects[after_index - 1]
                if submitted and expected_output.encode() in output and after_index < len(after_commands):
                    output.clear()
                    os.write(master, after_commands[after_index].encode())
                    after_typed_at = time.monotonic()
                    after_index += 1
                    submitted = False
                    confirmation_complete = False
                    submission_at = None
                    continue
                if after_index and not submitted and time.monotonic() - after_typed_at > 1:
                    os.write(master, b'\r')
                    submitted = True
                    sent_at = time.monotonic()
                    submission_at = sent_at
                    output.clear()
                command_submitted = submitted and (confirmation_complete or not (args.confirm or args.second_enter))
                result_output = command_submitted and expected_output.encode() in output and (not args.post_submit_marker or args.post_submit_marker.encode() in output or args.post_submit_marker.encode() in transcript)
                if result_output:
                    if b'runtime unavailable' in output or b'No matching commands' in output:
                        raise RuntimeError('Command was unavailable or its RPC failed')
                    if args.expect_color:
                        expected_theme = args.expect_theme or args.initial_theme or 'carthage'
                        theme_config = json.loads((root / 'config/opencode/cli.json').read_text())
                        assert theme_config['theme']['name'] == expected_theme, theme_config
                        channels = [part.strip() for part in args.expect_color.split(',')]
                        if len(channels) != 3 or any(not part.isdigit() or int(part) > 255 for part in channels):
                            raise ValueError('--expect-color must be an RGB triple such as 242,198,109')
                        ansi = f"\x1b[38;2;{';'.join(channels)}m".encode()
                        color_output = output
                        if args.expect_startup_color and ansi not in (pre_submit_transcript or b''):
                            raise AssertionError('Expected theme accent was not rendered on process startup after profile reload')
                        if args.expect_theme and ansi in (pre_submit_transcript or b''):
                            raise AssertionError('Expected theme accent was already rendered before submitting the theme command')
                        if args.expect_theme and theme_config == initial_config:
                            raise AssertionError('Theme configuration was not changed by the submitted command')
                        if ansi not in color_output:
                            print(f'Expected rendered foreground color {ansi!r} was not observed; recent raw PTY bytes: {output[-12000:]!r}')
                            raise AssertionError('Rendered accent color did not match the selected native theme')
                    if args.expect_theme:
                        persisted = json.loads(cli_config_path.read_text()) if cli_config_path.exists() else {}
                        selection = persisted.get('theme')
                        persisted_name = selection.get('name') if isinstance(selection, dict) else selection
                        expected_selection = expected_persisted_config.get('theme') if expected_persisted_config else None
                        expected_name = expected_selection.get('name') if isinstance(expected_selection, dict) else expected_selection
                        if persisted_name != expected_name:
                            raise AssertionError(f'Persisted theme selection mismatch after command: expected {expected_name!r}, got {persisted_name!r}')
                    print(json.dumps({'command': args.command, 'observed': expected_output,
                                      'postSubmission': True, 'enterCount': enter_count,
                                       'theme': (args.expect_theme or args.initial_theme or 'carthage') if args.expect_color else None,
                                      'ansiColor': args.expect_color,
                                      'elapsedMs': round((time.monotonic() - started) * 1000),
                                       'terminalBytes': len(output)}))
                    return
            plain = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', bytes(output))
            diagnostic = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', bytes(transcript))
            for log in (root / 'data').rglob('*.log'):
                lines = [line for line in log.read_text(errors='replace').splitlines()
                         if 'plugin' in line.lower() or 'error' in line.lower()]
                print('\n'.join(lines[-30:]))
            raise RuntimeError(f'Expected {args.expect!r} not rendered after natural typed command + Enter. Latest screen: {plain[-8000:].decode(errors="replace")}\nPTY transcript diagnostics: {diagnostic[-4000:].decode(errors="replace")}')
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            os.close(master)


if __name__ == '__main__':
    main()
