/**
 * Best-effort clipboard *read* for the pi2 console.
 *
 * Terminals normally deliver a paste as bracketed-paste bytes, which the key
 * parser already understands. Some setups instead bind Ctrl+V to the app
 * (which only sees a raw 0x16 byte), so we shell out to the platform clipboard
 * utility and fall back to a no-op when none is available. pi2 stays
 * dependency-free: these are all standard OS/desktop tools (or PowerShell on
 * Windows/WSL), tried in order until one answers.
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

/** Normalize clipboard text. Single-line fields strip all whitespace/control
 *  bytes (keys, codes, URLs); multi-line keeps newlines but drops control junk. */
export function sanitizePaste(text, { multiline = false } = {}) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (multiline) return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return s.replace(/[\s\u0000-\u001f\u007f]+/g, '');
}

/** Read the OS clipboard, resolving to '' when no tool works. Never rejects. */
export function readClipboard({ platform = process.platform, env = process.env, timeoutMs = 1200 } = {}) {
  const commands = clipboardCommands(platform, env);
  return new Promise(resolve => {
    let index = 0;
    const next = () => {
      const entry = commands[index++];
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
