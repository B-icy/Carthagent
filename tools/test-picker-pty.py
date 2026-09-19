"""Offline real terminal input smoke test (POSIX, no provider requests)."""
import os
import pty
import select
import subprocess
import tempfile
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='carthagent picker ') as home:
    master, slave = pty.openpty()
    env = dict(os.environ, HOME=home, XDG_CONFIG_HOME=home)
    child = subprocess.Popen(['node', str(root / 'bin/ctg.mjs'), 'demo'], stdin=slave, stdout=slave, stderr=slave, cwd=home, env=env)
    os.close(slave)
    def collect(seconds=1):
        end = time.monotonic() + seconds
        data = b''
        while time.monotonic() < end:
            if select.select([master], [], [], .05)[0]:
                data += os.read(master, 65536)
        return data.decode('utf-8', errors='replace')
    try:
        collect(2)
        os.write(master, b'/mod\r')
        assert 'Select model' in collect(), 'single Enter did not open model picker'
        os.write(master, b'carthagent-demo-2\r')
        output = collect()
        assert 'model' in output and 'carthagent-demo-2' in output, 'model selection did not apply'
        os.write(master, b'/mod\t')
        output = collect()
        assert 'Select model' not in output, 'Tab unexpectedly opened picker'
        os.write(master, b'\r')
        assert 'Select model' in collect(), 'completed command did not activate'
        os.write(master, b'\x1b')
        collect()
        print('Real PTY: single Enter model picker, model commit, Tab completion and Escape passed')
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        os.close(master)
