#!/usr/bin/env python3
"""Opt-in real-PTY input, warm-session-switch, idle-output and RSS probe.

Run on a POSIX host with the pinned 2.0.32 binary and installed dependencies.
This measures the interactive terminal (including CTG plugin work), not RPC.
Startup and initial warm-up are excluded from latency samples.
"""
import argparse
import datetime
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

SAMPLES = 30
TARGET_INPUT_MS = 50
TARGET_SWITCH_MS = 150
ANSI = re.compile(rb"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")


def percentile95(values):
    ordered = sorted(values)
    return ordered[(len(ordered) * 95 + 99) // 100 - 1]


def host_conditions():
    result = {"capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "cpuCount": os.cpu_count()}
    try:
        result["loadAverage1m5m15m"] = [round(value, 2) for value in os.getloadavg()]
    except (AttributeError, OSError, ValueError):
        result["loadAverage1m5m15m"] = None
    try:
        values = {line.split(":", 1)[0]: int(line.split()[1])
                  for line in pathlib.Path("/proc/meminfo").read_text().splitlines()
                  if ":" in line and line.split()[1].isdigit()}
        result["hostMemoryMb"] = {key: round(values[key] / 1024, 1)
                                  for key in ("MemTotal", "MemAvailable") if key in values}
    except OSError:
        result["hostMemoryMb"] = None
    return result


class Terminal:
    def __init__(self, master, child):
        self.master, self.child = master, child
        self.transcript = bytearray()
        self.screen = Screen()

    def drain(self, timeout=0.05):
        if self.child.poll() is not None:
            tail = ANSI.sub(b"", bytes(self.transcript)).decode(errors="replace")[-2000:]
            raise RuntimeError(f"native TUI exited with {self.child.returncode}; screen={self.screen.dump()[-1200:]}; output={tail}")
        if not select.select([self.master], [], [], timeout)[0]:
            return b""
        try:
            chunk = os.read(self.master, 65536)
        except OSError:
            return b""
        self.transcript.extend(chunk)
        self.screen.feed(chunk)
        # Reply to terminal capability probes in a headless PTY.
        if b"\x1b[6n" in chunk:
            os.write(self.master, b"\x1b[1;1R")
        if b"\x1b[c" in chunk:
            os.write(self.master, b"\x1b[?1;2c")
        return chunk

    def collect_until(self, predicate, timeout, description):
        deadline = time.monotonic() + timeout
        seen = bytearray()
        while time.monotonic() < deadline:
            seen.extend(self.drain(min(0.05, deadline - time.monotonic())))
            if predicate(bytes(seen)):
                return bytes(seen)
        plain = ANSI.sub(b"", bytes(seen)).decode(errors="replace")
        raise TimeoutError(f"Timed out waiting for {description}; parsed screen: {self.screen.dump()[-1800:]}; output tail: {plain[-1500:]}")

    def send(self, data):
        os.write(self.master, data)


class Screen:
    """Small deterministic VT screen model for rendered-cell assertions."""
    def __init__(self, rows=36, cols=120):
        self.rows, self.cols = rows, cols
        self.cells = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.state = "text"
        self.sequence = ""
        self.pending = b""

    def _put(self, char):
        if char == "\n":
            self.row = min(self.rows - 1, self.row + 1)
        elif char == "\r":
            self.col = 0
        elif char == "\b":
            self.col = max(0, self.col - 1)
        elif char == "\t":
            self.col = min(self.cols - 1, (self.col // 8 + 1) * 8)
        elif char >= " " and char != "\x7f":
            if self.col >= self.cols:
                self.col = 0
                self.row = min(self.rows - 1, self.row + 1)
            self.cells[self.row][self.col] = char
            self.col += 1

    def _csi(self, final):
        raw = self.sequence[2:-1]
        params = [int(part) if part.isdigit() else 0 for part in raw.split(";")]
        n = params[0] or 1
        if final in "Hf":
            self.row = max(0, min(self.rows - 1, (params[0] or 1) - 1))
            self.col = max(0, min(self.cols - 1, (params[1] if len(params) > 1 and params[1] else 1) - 1))
        elif final == "A": self.row = max(0, self.row - n)
        elif final == "B": self.row = min(self.rows - 1, self.row + n)
        elif final == "C": self.col = min(self.cols - 1, self.col + n)
        elif final == "D": self.col = max(0, self.col - n)
        elif final == "G": self.col = max(0, min(self.cols - 1, n - 1))
        elif final == "d": self.row = max(0, min(self.rows - 1, n - 1))
        elif final == "K":
            mode = params[0] if params else 0
            start = 0 if mode == 1 else self.col
            end = self.col + 1 if mode == 1 else self.cols if mode == 2 else self.cols
            for col in range(start, end): self.cells[self.row][col] = " "
        elif final == "J":
            mode = params[0] if params else 0
            if mode == 2 or mode == 3:
                self.cells = [[" "] * self.cols for _ in range(self.rows)]
            elif mode == 0:
                for col in range(self.col, self.cols): self.cells[self.row][col] = " "
                for row in range(self.row + 1, self.rows): self.cells[row] = [" "] * self.cols
        elif final == "X":
            for col in range(self.col, min(self.cols, self.col + n)): self.cells[self.row][col] = " "
        elif final == "s":
            self.saved = (self.row, self.col)
        elif final == "u" and hasattr(self, "saved"):
            self.row, self.col = self.saved

    def feed(self, data):
        decoded = self.pending + data
        text = decoded.decode("utf-8", errors="replace")
        self.pending = b""
        # Retain an incomplete trailing UTF-8 sequence for the next PTY chunk.
        encoded = text.encode("utf-8")
        if encoded != decoded:
            for length in range(1, min(4, len(decoded)) + 1):
                try:
                    text = decoded[:-length].decode("utf-8")
                    self.pending = decoded[-length:]
                    break
                except UnicodeDecodeError:
                    continue
        for char in text:
            if self.state == "esc":
                if char == "[": self.state, self.sequence = "csi", "\x1b["
                elif char == "]": self.state = "osc"
                elif char == "7": self.state = "text"
                else: self.state = "text"
            elif self.state == "osc":
                if char == "\x07": self.state = "text"
                elif char == "\x1b": self.state = "osc-esc"
            elif self.state == "osc-esc":
                self.state = "text" if char == "\\" else "osc"
            elif self.state == "csi":
                self.sequence += char
                if "@" <= char <= "~":
                    self._csi(char)
                    self.state, self.sequence = "text", ""
            elif char == "\x1b": self.state = "esc"
            else: self._put(char)

    def lines(self):
        return ["".join(row).rstrip() for row in self.cells]

    def contains(self, text):
        return any(text in line for line in self.lines())

    def dump(self):
        return "\n".join(self.lines())


def locate_text(screen, text):
    for row, line in enumerate(screen.lines()):
        col = line.find(text)
        if col >= 0:
            return row, col
    return None


def editor_contains_typed_cell(screen, marker, before, row, editor_col):
    # The native placeholder's starting cell is the input origin. Restrict the
    # assertion to that exact cell; other changes on the editor row do not count.
    return (screen.cells[row][editor_col] == marker and
            before[row][editor_col] != marker)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default=os.environ.get("CTG_OPENCODE_BIN") or shutil.which("opencode"))
    parser.add_argument("--plugin", default=str(pathlib.Path(__file__).resolve().parents[1] / "plugins/carthagent"))
    parser.add_argument("--switch-fixture", help="JSON emitted by seed-native-switch-fixture.mjs; enables native Open Sessions switching")
    parser.add_argument("--no-plugin", action="store_true",
                        help="measure the native baseline without registering the CTG plugin")
    parser.add_argument("--samples", type=int, default=SAMPLES)
    parser.add_argument("--idle-seconds", type=float, default=10,
                        help="bounded idle observation window (default: 10s; max: 300s)")
    parser.add_argument("--idle-byte-limit", type=int, default=65536,
                        help="report idle-output budget; status-clock bytes are reported, not presumed a defect")
    parser.add_argument("--memory-growth-limit-mb", type=int, default=128,
                        help="documented RSS growth budget during idle window")
    parser.add_argument("--report", help="write machine-readable report JSON")
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("real PTY performance probe requires POSIX")
    if not args.binary:
        parser.error("provide --binary or CTG_OPENCODE_BIN for the owned 2.0.32 executable")
    if args.samples < 30:
        parser.error("at least 30 samples are required")
    if not 1 <= args.idle_seconds <= 300:
        parser.error("idle window must be between 1 and 300 seconds")
    if args.switch_fixture and args.no_plugin:
        parser.error("native Open Sessions switching requires the composed plugin and its isolated keybinding profile")
    binary = str(pathlib.Path(args.binary).resolve())
    fixture = json.loads(pathlib.Path(args.switch_fixture).read_text()) if args.switch_fixture else None
    owns_root = fixture is None
    root = pathlib.Path(tempfile.mkdtemp(prefix="ctg-native-terminal-perf-")) if owns_root else pathlib.Path(fixture["temp"])
    if owns_root:
        for name in ("home", "project", "config/opencode", "data", "state", "cache"):
            (root / name).mkdir(parents=True, exist_ok=True)
        config = {"update": "disable"}
        if not args.no_plugin:
            config["plugins"] = [str(pathlib.Path(args.plugin).resolve())]
        (root / "config/opencode/opencode.json").write_text(json.dumps(config))
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
    env.update({
        "HOME": str(root / "home"), "USERPROFILE": str(root / "home"),
        "TERM": "xterm-256color", "COLORTERM": "truecolor",
        "XDG_CONFIG_HOME": str(root / "config"), "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"), "XDG_CACHE_HOME": str(root / "cache"),
        "OPENCODE_DB": str(root / "database.sqlite"), "OPENCODE_CONFIG_PROJECT_DISABLE": "true",
    })
    if fixture:
        env["OPENCODE_PASSWORD"] = fixture["password"]
        env["CARTHAGENT_CODING_AGENT_DIR"] = str(root / "home/.carthagent/agent")
        env["PI_CODING_AGENT_DIR"] = str(root / "home/.carthagent/agent")
        env["HOME"] = str(root / "home")
        cwd = pathlib.Path(fixture["roots"]["alpha"])
        startup_session = fixture["sessions"]["alpha"]["id"]
        cwd.mkdir(parents=True, exist_ok=True)
        # The seeder has already started the pinned server once, so the host's
        # plugin/config/profile layout and database are all initialized here.
    else:
        cwd = root / "project"
        startup_session = None
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
    command = [binary, "--standalone"]
    if fixture:
        command = [binary, "--server", fixture["baseUrl"], "--session", startup_session]
    child = subprocess.Popen(command, cwd=cwd, env=env,
                             stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    terminal = Terminal(master, child)
    result = {"binary": binary, "expectedHostVersion": "2.0.32",
              "measurement": "real POSIX PTY; CTG plugin disabled baseline" if args.no_plugin else "real POSIX PTY; CTG plugin enabled",
              "startupIncludedInSamples": False, "samples": args.samples,
              "hostConditions": host_conditions()}
    if fixture:
        result["switchFixture"] = str(pathlib.Path(args.switch_fixture).resolve())
    try:
        # Wait on actual TUI readiness; never charge fixed sleeps to an input latency.
        terminal.collect_until(
            (lambda _output: terminal.screen.contains(fixture["sessions"]["alpha"]["marker"])) if fixture else
            (lambda output: b"Ask anything" in output and b"2.0.32" in output),
            90, "native 2.0.32 editor/session")
        # Allow the first genuine frame/plugin setup to settle, outside all sample clocks.
        terminal.drain(0.5)
        switch_ms = []
        switch_note = "not measured: provide --switch-fixture with two preloaded native sessions"
        if fixture:
            def select_native_session(session, timed):
                title = session["title"]
                if terminal.screen.contains(session["marker"]):
                    if not timed: return None
                    raise RuntimeError(f"Switch sample targeted already-active session {session['id']}")
                # In the pinned 2.0.32 TUI Ctrl+O opens Open Sessions. Search
                # by the exact fixture title, then time Enter-to-history render.
                terminal.send(b"\x0f")  # open.menu
                terminal.collect_until(lambda _output: locate_text(terminal.screen, "Search sessions and projects") is not None or
                                       locate_text(terminal.screen, "Recent Sessions") is not None or
                                       locate_text(terminal.screen, "Open") is not None,
                                       10, "native Open Sessions picker")
                terminal.send(title.encode())
                terminal.collect_until(lambda _output: locate_text(terminal.screen, title) is not None,
                                       10, f"native session row {title}")
                if terminal.screen.contains(session["marker"]):
                    raise RuntimeError(f"Destination marker {session['marker']} visible before selection")
                started = time.perf_counter_ns()
                terminal.send(b"\r")
                terminal.collect_until(lambda _output: terminal.screen.contains(session["marker"]), 10,
                                       f"unique rendered destination marker {session['marker']}")
                return (time.perf_counter_ns() - started) / 1_000_000 if timed else None

            # Visit both targets before the measured 30 alternations so their
            # session files and destination render state have been loaded.
            select_native_session(fixture["sessions"]["bravo"], False)
            select_native_session(fixture["sessions"]["alpha"], False)
            for index in range(SAMPLES):
                destination = fixture["sessions"]["bravo" if index % 2 == 0 else "alpha"]
                switch_ms.append(select_native_session(destination, True))
            switch_note = "30 alternating native Open Sessions menu selections; Enter-to-unique-assistant-history-marker render; both destinations explicitly prewarmed"
        editor_anchor = None if fixture else locate_text(terminal.screen, "Ask anything")
        editor_origin = None
        if fixture:
            # Switch-fixture mode is strictly switch-only; the separate
            # controlled input probe owns the editor-origin detector.
            input_ms = []
        elif editor_anchor is None:
            raise RuntimeError("native editor placeholder was not present in parsed screen")
        else:
            editor_row, editor_col = editor_anchor
            editor_origin = (editor_row, editor_col)
        if editor_origin is None:
            input_ms = []
        else:
            editor_origin = (editor_row, editor_col)
            input_ms = []
            for index in range(args.samples):
                marker = chr(ord("a") + index % 26)
                before = [row[:] for row in terminal.screen.cells]
                started = time.perf_counter_ns()
                terminal.send(marker.encode())
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    terminal.drain(0.01)
                    if editor_contains_typed_cell(terminal.screen, marker, before, *editor_origin):
                        input_ms.append((time.perf_counter_ns() - started) / 1_000_000)
                        break
                else:
                    raise TimeoutError(f"No terminal echo observed for key sample {index + 1}")
                terminal.send(b"\x7f")
                terminal.drain(0.02)

        result["input"] = {"samples": len(input_ms), "p95Ms": round(percentile95(input_ms), 3) if input_ms else None,
                           "maxMs": round(max(input_ms), 3) if input_ms else None, "targetMs": TARGET_INPUT_MS,
                           "targetMet": percentile95(input_ms) <= TARGET_INPUT_MS if input_ms else None,
                           **({"note": "not measured in switch-fixture mode; run controlled paired input probe separately"} if not input_ms else {}),
                             "basis": "keypress write to changed cell at native editor placeholder origin"}
        result["warmSessionSwitch"] = {"samples": len(switch_ms), "p95Ms": round(percentile95(switch_ms), 3) if switch_ms else None,
                                       "maxMs": round(max(switch_ms), 3) if switch_ms else None,
                                       "targetMs": TARGET_SWITCH_MS,
                                       "targetMet": percentile95(switch_ms) <= TARGET_SWITCH_MS if switch_ms else None,
                                        "note": switch_note,
                                        **({"sequenceMs": [round(value, 3) for value in switch_ms]} if switch_ms else {})}
        # Bounded idle observation; report all bytes and RSS trend. Native status
        # clocks may legitimately redraw, so byte activity alone is not a failure.
        def process_tree_rss_kb():
            # Include plugin/runtime descendants when Linux exposes process stats.
            try:
                parent = {child.pid}
                rss_total = 0
                while parent:
                    discovered = set()
                    for proc in pathlib.Path("/proc").iterdir():
                        if not proc.name.isdecimal():
                            continue
                        try:
                            status = (proc / "status").read_text()
                            ppid = int(status.split("PPid:")[1].split()[0])
                            if ppid in parent:
                                discovered.add(int(proc.name))
                            if int(proc.name) in parent:
                                rss_total += int(status.split("VmRSS:")[1].split()[0])
                        except (OSError, IndexError, ValueError):
                            continue
                    parent = discovered
                return rss_total
            except OSError:
                return None
        idle_start_bytes = len(terminal.transcript)
        rss = []
        idle_deadline = time.monotonic() + args.idle_seconds
        while time.monotonic() < idle_deadline:
            terminal.drain(0.1)
            sample = process_tree_rss_kb()
            if sample is not None:
                rss.append(sample)
        idle_bytes = len(terminal.transcript) - idle_start_bytes
        growth_mb = ((max(rss) - min(rss)) / 1024) if rss else None
        result["idle"] = {"windowSeconds": args.idle_seconds, "ptyBytes": idle_bytes,
                           "byteBudget": args.idle_byte_limit, "byteBudgetMet": idle_bytes <= args.idle_byte_limit,
                           "rssSamples": len(rss), "rssMinMb": round(min(rss) / 1024, 2) if rss else None,
                           "rssMaxMb": round(max(rss) / 1024, 2) if rss else None,
                           "rssGrowthMb": round(growth_mb, 2) if growth_mb is not None else None,
                           "rssGrowthBudgetMb": args.memory_growth_limit_mb,
                           "rssGrowthBudgetMet": growth_mb <= args.memory_growth_limit_mb if growth_mb is not None else None,
                           "rssScope": "native process plus descendants where /proc is available",
                           "interpretation": "PTY bytes are observational only; native status redraws are not assumed plugin defects"}
        result["hostConditionsAtRunEnd"] = host_conditions()
        result["overallTargetsMet"] = bool(result["input"]["targetMet"] and
                                           result["warmSessionSwitch"]["targetMet"] is True and
                                           result["idle"]["rssGrowthBudgetMet"] is True)
        text = json.dumps(result, indent=2)
        print(text)
        if args.report:
            pathlib.Path(args.report).write_text(text + "\n")
        if not result["overallTargetsMet"]:
            raise SystemExit(1)
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        os.close(master)
        if owns_root:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
