/**
 * Best-effort clipboard *read* and *write* for the pi2 console.
 *
 * Terminals normally deliver a paste as bracketed-paste bytes, which the key
 * parser already understands. Some setups instead bind Ctrl+V to the app
 * (which only sees a raw 0x16 byte), so we shell out to the platform clipboard
 * utility and fall back to a no-op when none is available.
 *
 * Similarly, terminal drag-selection (auto copy) emits OSC 52 escapes for
 * compatible terminals, but macOS Terminal.app and many default configurations
 * (e.g. iTerm2 without explicit clipboard access enabled, tmux) do not populate
 * the system clipboard via OSC 52. We shell out to the native clipboard writer
 * (pbcopy on macOS, wl-copy/xclip/xsel on Linux, clip.exe on Windows/WSL) so the
 * selected text lands in the OS pasteboard directly.
 *
 * pi2 stays dependency-free: these are all standard OS/desktop tools (or
 * PowerShell/clip on Windows/WSL), tried in order until one answers.
 */
import { execFile } from 'node:child_process';

/** Clipboard read commands for a platform, in preference order. */
export function clipboardCommands(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return [['pbpaste', []]];
  if (platform === 'win32') return [['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard']]];
  const linux = [
    ['wl-paste', ['-n']],
    ['xclip', ['-selection', 'clipboard', '-o']],
    ['xsel', ['--clipboard', '--output']],
  ];
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV) {
    linux.push(['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard']]);
  }
  return linux;
}

/** Clipboard write commands for a platform, in preference order. */
export function clipboardWriteCommands(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return [['pbcopy', []]];
  if (platform === 'win32') return [
    ['clip.exe', []],
    ['powershell.exe', ['-NoProfile', '-Command', '$input | Set-Clipboard']],
  ];
  const linux = [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV) {
    linux.push(['clip.exe', []]);
    linux.push(['powershell.exe', ['-NoProfile', '-Command', '$input | Set-Clipboard']]);
  }
  return linux;
}

/** Normalize clipboard text. Single-line fields strip all whitespace/control
 *  bytes (keys, codes, URLs); multi-line keeps newlines but drops control junk. */
export function sanitizePaste(text, { multiline = false } = {}) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (multiline) return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return s.replace(/[\s\u0000-\u001f\u007f]+/g, '');
}

/** Read the OS clipboard, resolving to '' when no tool works. Never rejects. */
export function readClipboard({ platform = process.platform, env = process.env, timeoutMs = 1200, commands = null } = {}) {
  const cmds = commands || clipboardCommands(platform, env);
  return new Promise(resolve => {
    let index = 0;
    const next = () => {
      const entry = cmds[index++];
      if (!entry) { resolve(''); return; } // no tool answered
      const [cmd, args] = entry;
      try {
        execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
          if (error) next();                // missing/failed tool → try the next
          else resolve(String(stdout || ''));
        });
      } catch { next(); }
    };
    next();
  });
}

/** Write text to the OS clipboard, resolving to true on success or false when no tool works. Never rejects. */
export function writeClipboard(text, { platform = process.platform, env = process.env, timeoutMs = 1200, commands = null } = {}) {
  const cmds = commands || clipboardWriteCommands(platform, env);
  const data = String(text ?? '');
  return new Promise(resolve => {
    let index = 0;
    const next = () => {
      const entry = cmds[index++];
      if (!entry) { resolve(false); return; } // no tool answered
      const [cmd, args] = entry;
      let handled = false;
      try {
        const child = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (error) => {
          if (handled) return;
          handled = true;
          if (error) next();
          else resolve(true);
        });
        child.on('error', () => {
          if (handled) return;
          handled = true;
          next();
        });
        if (child.stdin) {
          child.stdin.on('error', () => {});
          child.stdin.end(data);
        }
      } catch {
        if (!handled) {
          handled = true;
          next();
        }
      }
    };
    next();
  });
}
