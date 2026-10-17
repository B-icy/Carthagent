#!/usr/bin/env python3
"""Opt-in real-PTY input, warm-session-switch, idle-output and RSS probe.

Run on a POSIX host with the pinned 2.0.32 binary and installed dependencies.
This measures the interactive terminal (including CTG plugin work), not RPC.
Startup and initial warm-up are excluded from latency samples.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import pty
import re
import signal
import select
import shutil
import struct
import subprocess
import tempfile
import threading
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


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class HostSampler:
    """Capture host load and available memory across the timed measurement window."""
    def __init__(self, interval):
        self.interval = interval
        self.started_ns = None
        self.samples = []
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self.started_ns = time.monotonic_ns()
        self._sample()
        self._thread = threading.Thread(target=self._run, name="native-perf-host-sampler", daemon=True)
        self._thread.start()

    def _sample(self):
        sample = host_conditions()
        sample["elapsedNs"] = time.monotonic_ns() - self.started_ns
        self.samples.append(sample)

    def _run(self):
        while not self._stop.wait(self.interval):
            self._sample()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join()
        self._sample()
        return self.samples


class Terminal:
    def __init__(self, master, child):
        self.master, self.child = master, child
        self.transcript = bytearray()
        self.screen = Screen()
        self.pollCount = 0
        self.pollWaitNs = 0
        self.readNs = 0
        self.screenFeedNs = 0
        self.detectionNs = 0

    def drain(self, timeout=0.05):
        if self.child.poll() is not None:
            tail = ANSI.sub(b"", bytes(self.transcript)).decode(errors="replace")[-2000:]
            raise RuntimeError(f"native TUI exited with {self.child.returncode}; screen={self.screen.dump()[-1200:]}; output={tail}")
        poll_started = time.perf_counter_ns()
        ready = select.select([self.master], [], [], timeout)[0]
        self.pollCount += 1
        self.pollWaitNs += time.perf_counter_ns() - poll_started
        if not ready:
            return b""
        try:
            read_started = time.perf_counter_ns()
            chunk = os.read(self.master, 65536)
            self.readNs += time.perf_counter_ns() - read_started
        except OSError:
            return b""
        self.transcript.extend(chunk)
        feed_started = time.perf_counter_ns()
        self.screen.feed(chunk)
        self.screenFeedNs += time.perf_counter_ns() - feed_started
        # Reply to terminal capability probes in a headless PTY.
        if b"\x1b[6n" in chunk:
            os.write(self.master, b"\x1b[1;1R")
        if b"\x1b[c" in chunk:
            os.write(self.master, b"\x1b[?1;2c")
        return chunk

    def collect_until(self, predicate, timeout, description, poll_interval=0.05):
        deadline = time.monotonic() + timeout
        seen = bytearray()
        while time.monotonic() < deadline:
            seen.extend(self.drain(min(poll_interval, deadline - time.monotonic())))
            predicate_started = time.perf_counter_ns()
            matched = predicate(bytes(seen))
            self.detectionNs += time.perf_counter_ns() - predicate_started
            if matched:
                return bytes(seen)
        plain = ANSI.sub(b"", bytes(seen)).decode(errors="replace")
        raise TimeoutError(f"Timed out waiting for {description}; parsed screen: {self.screen.dump()[-1800:]}; output tail: {plain[-1500:]}")

    def send(self, data):
        os.write(self.master, data)

    def observer_snapshot(self):
        return {"pollCount": self.pollCount, "pollWaitNs": self.pollWaitNs,
                "readNs": self.readNs, "screenFeedNs": self.screenFeedNs,
                "detectionNs": self.detectionNs}

    def observer_delta(self, before):
        after = self.observer_snapshot()
        return {key: after[key] - before[key] for key in after}


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


NATIVE_EDITOR_PLACEHOLDER = "Message carthagent…"


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
    parser.add_argument("--readiness-only", action="store_true",
                        help="bounded, non-timed real-PTY editor echo/backspace check; no performance samples")
    parser.add_argument("--no-plugin", action="store_true",
                        help="measure the native baseline without registering the CTG plugin")
    parser.add_argument("--samples", type=int, default=SAMPLES)
    parser.add_argument("--host-sample-interval", type=float, default=1.0,
                        help="seconds between load/memory observations during measured samples")
    parser.add_argument("--idle-seconds", type=float, default=10,
                        help="bounded idle observation window (default: 10s; max: 300s)")
    parser.add_argument("--idle-byte-limit", type=int, default=65536,
                        help="report idle-output budget; status-clock bytes are reported, not presumed a defect")
    parser.add_argument("--memory-growth-limit-mb", type=int, default=None,
                        help="optional operator-approved RSS growth threshold; no product threshold is currently defined")
    parser.add_argument("--report", help="write machine-readable report JSON")
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("real PTY performance probe requires POSIX")
    if not args.binary:
        parser.error("provide --binary or CTG_OPENCODE_BIN for the owned 2.0.32 executable")
    if args.samples < 30 and not args.readiness_only:
        parser.error("at least 30 samples are required")
    if not 1 <= args.idle_seconds <= 300:
        parser.error("idle window must be between 1 and 300 seconds")
    if not 0.1 <= args.host_sample_interval <= 30:
        parser.error("host sample interval must be between 0.1 and 30 seconds")
    binary = str(pathlib.Path(args.binary).resolve())
    fixture = json.loads(pathlib.Path(args.switch_fixture).read_text()) if args.switch_fixture else None
    if fixture:
        observed = fixture.get("pluginObservation", {}).get("observed")
        native_inventory = fixture.get("pluginInventory")
        inventory_ids = [item.get("id") for item in native_inventory if isinstance(item, dict)] if isinstance(native_inventory, list) else None
        expected = os.environ.get("CTG_PERF_EXPECT_PLUGIN")
        if observed not in ("active", "absent") or expected != observed:
            parser.error("fixture must match the expected observed native plugin inventory state")
        if inventory_ids is None:
            parser.error("fixture must include the native plugin.list inventory observation")
        if observed == "active" and not any(isinstance(item, dict) and item.get("id") == "carthagent" and
                                            isinstance(item.get("state"), dict) and item["state"].get("status") == "active"
                                            for item in native_inventory):
            parser.error("native plugin.list inventory does not show Carthagent active")
        if observed == "absent" and any(isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].startswith("carthagent") for item in native_inventory):
            parser.error("baseline native plugin.list inventory contains a Carthagent plugin")
        if observed == "active" and (fixture.get("pluginHealth", {}).get("hostVersion") != "2.0.32" or
                                      fixture.get("pluginHealth", {}).get("protocol") != 1 or
                                      fixture.get("pluginHealth", {}).get("directoryMatches") is not True):
            parser.error("CTG fixture is missing a successful native health RPC verification")
        if fixture.get("provenance", {}).get("binarySha256") != hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest():
            parser.error("fixture binary hash does not match the executable being measured")
        if not os.environ.get("CTG_PERF_SOURCE_COMMIT") or fixture.get("provenance", {}).get("sourceCommit") != os.environ["CTG_PERF_SOURCE_COMMIT"]:
            parser.error("fixture source commit does not match selected immutable execution snapshot")
        if fixture.get("provenance", {}).get("sourceSnapshotSha256") != os.environ.get("CTG_PERF_SOURCE_SNAPSHOT_SHA256"):
            parser.error("fixture execution snapshot hash does not match runner snapshot")
        if observed == "active" and not fixture.get("provenance", {}).get("sourceSnapshotSha256"):
            parser.error("active CTG fixture is missing immutable source snapshot provenance")
        if not fixture.get("roots", {}).get("alpha") or not fixture.get("sessions", {}).get("alpha", {}).get("id") or not fixture.get("sessions", {}).get("bravo", {}).get("id"):
            parser.error("paired fixture must include both disposable session destinations")
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
        env["NODE_PATH"] = os.environ.get("NODE_PATH", "")
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
    try:
        child = subprocess.Popen(command, cwd=cwd, env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    except BaseException:
        os.close(master)
        os.close(slave)
        if owns_root:
            shutil.rmtree(root, ignore_errors=True)
        raise
    os.close(slave)
    terminal = Terminal(master, child)
    previous_sigterm = signal.getsignal(signal.SIGTERM)
    def handle_sigterm(_signum, _frame):
        raise KeyboardInterrupt("received SIGTERM")
    signal.signal(signal.SIGTERM, handle_sigterm)
    try:
        result = {"binary": binary, "expectedHostVersion": "2.0.32",
                  "measurement": "real POSIX PTY; native plugin inventory observed active" if fixture and fixture.get("pluginObservation", {}).get("observed") == "active" else "real POSIX PTY; native plugin inventory observed absent",
                  "startupIncludedInSamples": False, "samples": args.samples,
                  "measurementScope": "terminal interaction through select/read/VT parse and parsed PTY screen evidence; not compositor/GPU presentation; observer overhead is reported and never subtracted",
                  "hostConditions": host_conditions()}
        if fixture:
            result["switchFixture"] = str(pathlib.Path(args.switch_fixture).resolve())
            result["pluginObservation"] = fixture.get("pluginObservation")
            result["pluginInventory"] = fixture.get("pluginInventory")
            result["pluginHealth"] = fixture.get("pluginHealth")
            result["provenance"] = fixture.get("provenance")
            result["sourceProvenance"] = {"commit": os.environ.get("CTG_PERF_SOURCE_COMMIT"),
                                           "snapshotSha256": os.environ.get("CTG_PERF_SOURCE_SNAPSHOT_SHA256"),
                                           "sourceDirectory": os.environ.get("CTG_PERF_SOURCE_DIR")}
            if os.environ.get("CTG_PERF_SOURCE_COMMIT") and not fixture.get("pluginObservation", {}).get("observed"):
                raise RuntimeError("Fixture lacks verified native plugin condition; refusing performance artifact")
    except BaseException:
        signal.signal(signal.SIGTERM, previous_sigterm)
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
        raise
    try:
        # Wait on actual TUI readiness; never charge fixed sleeps to an input latency.
        terminal.collect_until(
            (lambda _output: terminal.screen.contains(fixture["sessions"]["alpha"]["marker"])) if fixture else
            (lambda _output: locate_text(terminal.screen, NATIVE_EDITOR_PLACEHOLDER) is not None),
            90, "native editor placeholder/session")
        # Allow the first genuine frame/plugin setup to settle, outside all sample clocks.
        terminal.drain(0.5)
        switch_ms = []
        switch_observations = []
        input_observations = []
        input_warmup_observation = None
        sampler = HostSampler(args.host_sample_interval)
        switch_note = "not measured: provide --switch-fixture with two preloaded native sessions"
        if fixture and not args.readiness_only:
            sampler.start()
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
                observer_before = terminal.observer_snapshot()
                started_at = utc_now()
                started = time.perf_counter_ns()
                started_monotonic_ns = time.monotonic_ns()
                terminal.send(b"\r")
                try:
                    terminal.collect_until(lambda _output: terminal.screen.contains(session["marker"]), 10,
                                           f"unique rendered destination marker {session['marker']}", poll_interval=0.001)
                except Exception as error:
                    failed_ns = time.perf_counter_ns()
                    failed_monotonic_ns = time.monotonic_ns()
                    if timed:
                        switch_observations.append({"sample": len(switch_observations) + 1,
                                                    "sessionId": session["id"], "marker": session["marker"],
                                                    "status": "failed", "startedAt": started_at,
                                                    "failedAt": utc_now(),
                                                    "startedMonotonicNs": started_monotonic_ns,
                                                    "failedMonotonicNs": failed_monotonic_ns,
                                                    "elapsedToFailureNs": failed_ns - started,
                                                    "failure": f"{type(error).__name__}: {error}",
                                                    "destinationMarkerVerified": terminal.screen.contains(session["marker"]),
                                                    "observerWork": terminal.observer_delta(observer_before),
                                                    "timingScope": "Enter write through select/read/VT parse and parsed PTY marker observation; not compositor presentation"})
                    raise
                completed_ns = time.perf_counter_ns()
                completed_monotonic_ns = time.monotonic_ns()
                completed_at = utc_now()
                elapsed_ns = completed_ns - started
                if timed:
                    switch_observations.append({"sessionId": session["id"], "marker": session["marker"],
                                                "startedAt": started_at, "completedAt": completed_at,
                                                "startedMonotonicNs": started_monotonic_ns,
                                                "completedMonotonicNs": completed_monotonic_ns,
                                                "elapsedNs": elapsed_ns, "elapsedMs": elapsed_ns / 1_000_000,
                                                "destinationMarkerVerified": terminal.screen.contains(session["marker"]),
                                                "observerWork": terminal.observer_delta(observer_before),
                                                "timingScope": "Enter write through select/read/VT parse and parsed PTY marker observation; not compositor presentation"})
                    return elapsed_ns / 1_000_000
                return None

            # Visit both targets before the measured 30 alternations so their
            # session files and destination render state have been loaded.
            select_native_session(fixture["sessions"]["bravo"], False)
            select_native_session(fixture["sessions"]["alpha"], False)
            for index in range(args.samples):
                destination = fixture["sessions"]["bravo" if index % 2 == 0 else "alpha"]
                try:
                    switch_ms.append(select_native_session(destination, True))
                except Exception as error:
                    if not any(sample.get("sample") == index + 1 for sample in switch_observations):
                        switch_observations.append({"sample": index + 1, "sessionId": destination["id"],
                                                    "marker": destination["marker"], "status": "failed",
                                                    "failure": f"{type(error).__name__}: {error}",
                                                    "failedAt": utc_now(),
                                                    "timingScope": "Enter write through select/read/VT parse and parsed PTY marker observation; not compositor presentation"})
                    switch_ms.append(None)
                    try:
                        terminal.send(b"\x1b")
                        terminal.drain(0.1)
                    except Exception:
                        pass
            switch_note = f"{args.samples} alternating native Open Sessions menu selections; Enter-to-unique-assistant-history-marker render; both destinations explicitly prewarmed"
        if args.readiness_only:
            terminal.collect_until(lambda _output: locate_text(terminal.screen, NATIVE_EDITOR_PLACEHOLDER) is not None,
                                   10, "native editor placeholder")
        editor_anchor = locate_text(terminal.screen, NATIVE_EDITOR_PLACEHOLDER)
        editor_origin = None
        if editor_anchor is None:
            raise RuntimeError(f"native editor placeholder {NATIVE_EDITOR_PLACEHOLDER!r} was not present; parsed screen: {terminal.screen.dump()[-1800:]}")
        else:
            editor_row, editor_col = editor_anchor
            editor_origin = (editor_row, editor_col)
        editor_empty_cell = terminal.screen.cells[editor_origin[0]][editor_origin[1]]
        if args.readiness_only:
            if fixture:
                sampler.start()
            before = [row[:] for row in terminal.screen.cells]
            terminal.send(b"z")
            terminal.collect_until(lambda _output: editor_contains_typed_cell(terminal.screen, "z", before, *editor_origin),
                                   2, "changed typed cell at native editor input origin", poll_interval=0.001)
            typed_cell = terminal.screen.cells[editor_origin[0]][editor_origin[1]]
            terminal.send(b"\x7f")
            terminal.collect_until(lambda _output: terminal.screen.cells[editor_origin[0]][editor_origin[1]] == editor_empty_cell and
                                   locate_text(terminal.screen, NATIVE_EDITOR_PLACEHOLDER) == editor_origin,
                                   1, "native editor placeholder restored after backspace", poll_interval=0.001)
            readiness = {"readinessOnly": True, "timedSamplesRun": False,
                         "nativeEditorPlaceholder": NATIVE_EDITOR_PLACEHOLDER,
                         "inputOrigin": {"row": editor_origin[0], "column": editor_origin[1]},
                         "placeholderCell": editor_empty_cell, "typedCell": typed_cell,
                         "changedCellAtInputOrigin": before[editor_origin[0]][editor_origin[1]] != typed_cell,
                         "restoredPlaceholderVerified": True,
                         "pluginObservation": fixture.get("pluginObservation") if fixture else None,
                         "measurementScope": "bounded real-PTY readiness/echo only; no latency samples or performance claim"}
            if fixture:
                readiness["hostConditionsDuringReadiness"] = sampler.stop()
            text = json.dumps(readiness, indent=2)
            print(text)
            if args.report:
                pathlib.Path(args.report).write_text(text + "\n")
            return
        input_ms = []

        def send_and_verify_input(marker, sample_index, timed):
            before = [row[:] for row in terminal.screen.cells]
            observer_before = terminal.observer_snapshot()
            started_at = utc_now()
            started = time.perf_counter_ns()
            started_monotonic_ns = time.monotonic_ns()
            terminal.send(marker.encode())
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    terminal.drain(0.001)
                except Exception as error:
                    if timed:
                        input_observations.append({"sample": sample_index, "key": marker, "status": "failed",
                                                   "startedAt": started_at, "failedAt": utc_now(),
                                                   "startedMonotonicNs": started_monotonic_ns,
                                                   "failedMonotonicNs": time.monotonic_ns(),
                                                   "failure": f"{type(error).__name__}: {error}"})
                    raise
                detect_started = time.perf_counter_ns()
                detected = editor_contains_typed_cell(terminal.screen, marker, before, *editor_origin)
                terminal.detectionNs += time.perf_counter_ns() - detect_started
                if detected:
                    completed_ns = time.perf_counter_ns()
                    completed_monotonic_ns = time.monotonic_ns()
                    completed_at = utc_now()
                    elapsed_ns = completed_ns - started
                    observation = {"sample": sample_index, "key": marker, "status": "passed",
                                   "startedAt": started_at, "completedAt": completed_at,
                                   "startedMonotonicNs": started_monotonic_ns,
                                   "completedMonotonicNs": completed_monotonic_ns,
                                   "elapsedNs": elapsed_ns, "elapsedMs": elapsed_ns / 1_000_000,
                                   "editorInputOrigin": {"row": editor_origin[0], "column": editor_origin[1]},
                                   "beforeCell": before[editor_origin[0]][editor_origin[1]],
                                   "afterCell": terminal.screen.cells[editor_origin[0]][editor_origin[1]],
                                   "changedCellAtInputOrigin": True,
                                   "observerWork": terminal.observer_delta(observer_before),
                                   "timingScope": "keypress write through select/read/VT parse and changed-cell observation; not compositor presentation"}
                    if timed:
                        input_ms.append(elapsed_ns / 1_000_000)
                        input_observations.append(observation)
                    else:
                        nonlocal input_warmup_observation
                        input_warmup_observation = observation
                    terminal.send(b"\x7f")
                    terminal.collect_until(
                        lambda _output: terminal.screen.cells[editor_origin[0]][editor_origin[1]] == editor_empty_cell,
                        1, "editor restored to empty placeholder after backspace", poll_interval=0.001)
                    return True
            if timed:
                input_observations.append({"sample": sample_index, "key": marker, "status": "failed",
                                           "startedAt": started_at, "failedAt": utc_now(),
                                           "startedMonotonicNs": started_monotonic_ns,
                                           "failedMonotonicNs": time.monotonic_ns(),
                                           "failure": "TimeoutError: no changed cell at parsed editor input origin within 2 seconds",
                                           "editorInputOrigin": {"row": editor_origin[0], "column": editor_origin[1]},
                                           "beforeCell": before[editor_origin[0]][editor_origin[1]],
                                           "afterCell": terminal.screen.cells[editor_origin[0]][editor_origin[1]],
                                           "observerWork": terminal.observer_delta(observer_before)})
            else:
                input_warmup_observation = {"sample": 0, "key": marker, "status": "failed",
                                            "startedAt": started_at, "failedAt": utc_now(),
                                            "startedMonotonicNs": started_monotonic_ns,
                                            "failedMonotonicNs": time.monotonic_ns(),
                                            "failure": "TimeoutError: warmup key not observed at parsed editor input origin",
                                            "editorInputOrigin": {"row": editor_origin[0], "column": editor_origin[1]},
                                            "beforeCell": before[editor_origin[0]][editor_origin[1]],
                                            "afterCell": terminal.screen.cells[editor_origin[0]][editor_origin[1]],
                                            "observerWork": terminal.observer_delta(observer_before)}
                # Attempt to restore the input field after an undetected echo;
                # this cleanup is outside any successful sample clock.
                terminal.send(b"\x7f")
                terminal.collect_until(
                    lambda _output: terminal.screen.cells[editor_origin[0]][editor_origin[1]] == editor_empty_cell,
                    1, "editor restored to empty placeholder after failed key", poll_interval=0.001)
            return False

        # Warm the editor/input path once; only the following N key echoes count.
        input_warmup_passed = send_and_verify_input("z", 0, False)
        for index in range(args.samples):
            try:
                send_and_verify_input(chr(ord("a") + index % 26), index + 1, True)
            except Exception as error:
                if not any(item.get("sample") == index + 1 and item.get("status") == "failed"
                           for item in input_observations):
                    input_observations.append({"sample": index + 1, "status": "failed",
                                               "failedAt": utc_now(), "failure": f"{type(error).__name__}: {error}"})
                input_ms.append(None)
        if not input_warmup_passed:
            result_warmup_failure = "warmup key not verified at editor input origin"
        else:
            result_warmup_failure = None
        if fixture:
            host_samples = sampler.stop()
        else:
            host_samples = []

        successful_input_ms = [value for value in input_ms if value is not None]
        successful_switch_ms = [value for value in switch_ms if value is not None]
        input_failed_samples = sum(item.get("status") == "failed" for item in input_observations)
        result["input"] = {"samples": args.samples, "successfulSamples": len(successful_input_ms),
                           "failedSamples": input_failed_samples,
                           "p95Ms": round(percentile95(successful_input_ms), 3) if successful_input_ms else None,
                           "maxMs": round(max(successful_input_ms), 3) if successful_input_ms else None, "targetMs": TARGET_INPUT_MS,
                           "targetMet": (result_warmup_failure is None and len(successful_input_ms) == args.samples and input_failed_samples == 0 and
                                         percentile95(successful_input_ms) <= TARGET_INPUT_MS),
                           "basis": "keypress write to changed cell at native editor placeholder origin",
                           "warmupSamplesExcluded": 1,
                           "warmupPassed": result_warmup_failure is None,
                           "warmupFailure": result_warmup_failure,
                           "warmupObservation": input_warmup_observation,
                           "editorInputOrigin": {"row": editor_origin[0], "column": editor_origin[1]},
                           "finalScreen": terminal.screen.lines(),
                           "finalEditorCell": terminal.screen.cells[editor_origin[0]][editor_origin[1]],
                           "finalEditorCellExpected": editor_empty_cell,
                           "finalEditorPlaceholderVerified": (locate_text(terminal.screen, NATIVE_EDITOR_PLACEHOLDER) == editor_origin and
                                                              terminal.screen.cells[editor_origin[0]][editor_origin[1]] == editor_empty_cell),
                           "rawSamples": input_observations}
        switch_failed_samples = sum(item.get("status") == "failed" for item in switch_observations)
        result["warmSessionSwitch"] = {"samples": args.samples if fixture else 0, "successfulSamples": len(successful_switch_ms),
                                       "failedSamples": switch_failed_samples,
                                       "p95Ms": round(percentile95(successful_switch_ms), 3) if successful_switch_ms else None,
                                       "maxMs": round(max(successful_switch_ms), 3) if successful_switch_ms else None,
                                       "targetMs": TARGET_SWITCH_MS,
                                       "targetMet": percentile95(successful_switch_ms) <= TARGET_SWITCH_MS if len(successful_switch_ms) == args.samples and switch_failed_samples == 0 else False,
                                        "note": switch_note,
                                          "sequenceMs": [round(value, 3) if value is not None else None for value in switch_ms],
                                         "rawSamples": switch_observations}
        if fixture:
            result["hostConditionsDuringMeasurement"] = host_samples
        result["observerTotals"] = terminal.observer_snapshot()
        # Bounded idle observation; report all bytes and RSS trend. Native status
        # clocks may legitimately redraw, so byte activity alone is not a failure.
        def process_tree_rss_kb(root_pid):
            # Include plugin/runtime descendants when Linux exposes process stats.
            try:
                root_pid = int(root_pid)
                if not pathlib.Path(f"/proc/{root_pid}/status").exists():
                    return None
                parent = {root_pid}
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
        tui_rss = []
        server_rss = []
        idle_deadline = time.monotonic() + args.idle_seconds
        while time.monotonic() < idle_deadline:
            terminal.drain(0.1)
            tui_sample = process_tree_rss_kb(child.pid)
            server_pid = fixture.get("serverPid") if fixture else None
            server_sample = process_tree_rss_kb(server_pid) if server_pid else None
            sample = ((tui_sample or 0) + (server_sample or 0)
                      if tui_sample is not None or server_sample is not None else None)
            if sample is not None:
                rss.append(sample)
            if tui_sample is not None:
                tui_rss.append(tui_sample)
            if server_sample is not None:
                server_rss.append(server_sample)
        idle_bytes = len(terminal.transcript) - idle_start_bytes
        growth_mb = ((max(rss) - min(rss)) / 1024) if rss else None
        result["idle"] = {"windowSeconds": args.idle_seconds, "ptyBytes": idle_bytes,
                           "byteBudget": args.idle_byte_limit, "byteBudgetMet": idle_bytes <= args.idle_byte_limit,
                           "rssSamples": len(rss), "rssMinMb": round(min(rss) / 1024, 2) if rss else None,
                           "rssMaxMb": round(max(rss) / 1024, 2) if rss else None,
                           "rssGrowthMb": round(growth_mb, 2) if growth_mb is not None else None,
                           "tuiProcessTreeRssMinMb": round(min(tui_rss) / 1024, 2) if tui_rss else None,
                           "tuiProcessTreeRssMaxMb": round(max(tui_rss) / 1024, 2) if tui_rss else None,
                           "ownedServerProcessTreeRssMinMb": round(min(server_rss) / 1024, 2) if server_rss else None,
                           "ownedServerProcessTreeRssMaxMb": round(max(server_rss) / 1024, 2) if server_rss else None,
                           "serverPid": fixture.get("serverPid") if fixture else None,
                           "rssGrowthBudgetMb": args.memory_growth_limit_mb,
                           "rssGrowthBudgetMet": (growth_mb <= args.memory_growth_limit_mb
                                                  if growth_mb is not None and args.memory_growth_limit_mb is not None else None),
                           "rssScope": "native process plus descendants where /proc is available",
                           "acceptance": "diagnostic only; no product-defined sustained-memory ceiling exists",
                           "interpretation": "PTY bytes and short-window RSS are observations only; native status redraws are not assumed plugin defects"}
        result["hostConditionsAtRunEnd"] = host_conditions()
        result["overallTargetsMet"] = bool(result["input"]["targetMet"] and
                                            result["warmSessionSwitch"]["targetMet"] is True and
                                            result["input"]["finalEditorPlaceholderVerified"])
        text = json.dumps(result, indent=2)
        print(text)
        if args.report:
            pathlib.Path(args.report).write_text(text + "\n")
        if not result["overallTargetsMet"]:
            raise SystemExit(1)
    except BaseException as error:
        if args.report:
            result["runStatus"] = "failed"
            result["runFailure"] = f"{type(error).__name__}: {error}"
            pathlib.Path(args.report).write_text(json.dumps(result, indent=2) + "\n")
        raise
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
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
