/** A single transient status line. It releases the terminal before the TUI owns it. */
export function createTerminalProgress({ stream = process.stderr, env = process.env, enabled = true, ascii = false, signal } = {}) {
  const interactive = enabled && stream.isTTY === true && env.TERM !== 'dumb';
  const reducedMotion = env.CTG_REDUCED_MOTION === '1';
  const frames = ascii ? ['|', '/', '-', '\\'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let timer, message = '', frame = 0, visible = false;
  const draw = () => {
    const columns = Math.max(1, (stream.columns || 80) - 1);
    const line = `${reducedMotion ? '·' : frames[frame++ % frames.length]} ${message}`;
    stream.write(`\r\x1b[2K${Array.from(line).slice(0, columns).join('')}`);
    visible = true;
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    if (visible) stream.write('\r\x1b[2K');
    visible = false;
    signal?.removeEventListener('abort', stop);
  };
  return {
    update(text) {
      if (!interactive || signal?.aborted) return;
      message = String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
      draw();
      if (!timer && !reducedMotion) { timer = setInterval(draw, 90); timer.unref?.(); }
      signal?.removeEventListener('abort', stop);
      signal?.addEventListener('abort', stop, { once: true });
    },
    stop,
  };
}
