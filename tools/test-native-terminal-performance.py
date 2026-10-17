#!/usr/bin/env python3
"""Opt-in real-PTY input, warm-session-switch, idle-output and RSS probe.

Run on a POSIX host with the pinned 2.0.32 binary and installed dependencies.
This measures the interactive terminal (including CTG plugin work), not RPC.
Startup and initial warm-up are excluded from latency samples.
"""
import argparse
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


class Terminal:
    def __init__(self, master, child):
        self.master, self.child = master, child
        self.transcript = bytearray()

    def drain(self, timeout=0.05):
        if self.child.poll() is not None:
            raise RuntimeError(f"native TUI exited with {self.child.returncode}")
        if not select.select([self.master], [], [], timeout)[0]:
            return b""
        try:
            chunk = os.read(self.master, 65536)
        except OSError:
            return b""
        self.transcript.extend(chunk)
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
        raise TimeoutError(f"Timed out waiting for {description}; output tail: {plain[-1500:]}")

    def send(self, data):
        os.write(self.master, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default=os.environ.get("CTG_OPENCODE_BIN") or shutil.which("opencode"))
    parser.add_argument("--plugin", default=str(pathlib.Path(__file__).resolve().parents[1] / "plugins/carthagent"))
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
    binary = str(pathlib.Path(args.binary).resolve())
    root = pathlib.Path(tempfile.mkdtemp(prefix="ctg-native-terminal-perf-"))
    for name in ("home", "project", "config/opencode", "data", "state", "cache"):
        (root / name).mkdir(parents=True, exist_ok=True)
    config = {"update": "disable"}
    if not args.no_plugin:
        config["plugins"] = [str(pathlib.Path(args.plugin).resolve())]
    (root / "config/opencode/opencode.json").write_text(json.dumps(config))
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
    env.update({
        "HOME": str(root / "home"), "TERM": "xterm-256color", "COLORTERM": "truecolor",
        "XDG_CONFIG_HOME": str(root / "config"), "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"), "XDG_CACHE_HOME": str(root / "cache"),
        "OPENCODE_DB": str(root / "database.sqlite"), "OPENCODE_CONFIG_PROJECT_DISABLE": "true",
    })
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
    child = subprocess.Popen([binary, "--standalone"], cwd=root / "project", env=env,
                             stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    terminal = Terminal(master, child)
    result = {"binary": binary, "expectedHostVersion": "2.0.32",
              "measurement": "real POSIX PTY; CTG plugin disabled baseline" if args.no_plugin else "real POSIX PTY; CTG plugin enabled",
              "startupIncludedInSamples": False, "samples": args.samples}
    try:
        # Wait on actual TUI readiness; never charge fixed sleeps to an input latency.
        terminal.collect_until(lambda b: b"Ask anything" in b and b"2.0.32" in b, 90, "native 2.0.32 editor")
        # Allow the first genuine frame/plugin setup to settle, outside all sample clocks.
        terminal.drain(0.5)
        input_ms = []
        for index in range(args.samples):
            marker = chr(ord("a") + index % 26)
            # A literal printable key is sent. Completion means its text was emitted
            # back by the TUI renderer in a post-key terminal frame, not merely read.
            before = len(terminal.transcript)
            started = time.perf_counter_ns()
            terminal.send(marker.encode())
            response = bytearray()
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                response.extend(terminal.drain(0.01))
                plain = ANSI.sub(b"", bytes(response))
                if marker.encode() in plain:
                    input_ms.append((time.perf_counter_ns() - started) / 1_000_000)
                    break
            else:
                raise TimeoutError(f"No terminal echo observed for key sample {index + 1}")
            terminal.send(b"\x7f")  # erase sample character before next repetition
            terminal.drain(0.02)

        switch_ms = []
        switch_note = "not measured: requires two durable sessions from separate root contexts"
        # A real keybinding enters the native selector; measure until return to the
        # editor after Enter. We refuse to call this a session-switch sample unless
        # a second session is visible and selected (checked from selector rendering).
        terminal.send(b"/resume\r")
        selector = bytearray()
        selector_deadline = time.monotonic() + 8
        while time.monotonic() < selector_deadline:
            selector.extend(terminal.drain(0.05))
            plain = ANSI.sub(b"", bytes(selector)).lower()
            if b"no sessions" in plain or b"1/1" in plain:
                break
            if b"session" in plain and (b"sort" in plain or b"scope" in plain):
                break
        selector_plain = ANSI.sub(b"", bytes(selector)).lower()
        if b"session" in selector_plain and b"no sessions" not in selector_plain:
            switch_note = "selector opened; true warm switch not scored without verifiable second-root fixture"
            # Selector invocation is not counted as a switch. Escape safely to editor.
            terminal.send(b"\x1b")
            terminal.drain(0.2)
        else:
            terminal.send(b"\x1b")
            terminal.drain(0.2)
        result["input"] = {"samples": len(input_ms), "p95Ms": round(percentile95(input_ms), 3),
                           "maxMs": round(max(input_ms), 3), "targetMs": TARGET_INPUT_MS,
                           "targetMet": percentile95(input_ms) <= TARGET_INPUT_MS,
                           "basis": "keypress write to matching rendered PTY echo observed"}
        result["warmSessionSwitch"] = {"samples": len(switch_ms), "p95Ms": None,
                                       "targetMs": TARGET_SWITCH_MS, "targetMet": None, "note": switch_note}
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
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
