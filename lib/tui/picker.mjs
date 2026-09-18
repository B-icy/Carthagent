/** Shared keyboard semantics: navigation is never a commit. */
export function pickerKey(picker, key, count) {
  if (picker.pending) return 'pending';
  const moves = { up: -1, down: 1, pgup: -8, pgdn: 8 };
  if (key in moves) picker.sel = Math.max(0, Math.min(Math.max(0, count - 1), picker.sel + moves[key]));
  if (key === 'esc') return 'cancel';
  if (key === 'enter' && count) return 'commit';
  return 'browse';
}

export async function commitPicker(picker, action, success) {
  if (picker.pending) return;
  picker.pending = true;
  picker.error = '';
  try { await action(); success(); }
  catch (error) { picker.error = error.message; }
  finally { picker.pending = false; }
}
