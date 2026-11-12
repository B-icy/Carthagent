/**
 * Options for "Choose completed work". Grouped by category instead of a per-row
 * description: the host renders descriptions inline after the title, so long
 * session titles ran into them and both were cut off. Verified Ship work comes
 * first, then work whose checks need refreshing, then sessions that need
 * user-entered evidence.
 * @param {readonly { id: string, title?: string }[]} sessions
 * @param {(id: string) => ({ origin?: string, freshness?: string } | undefined)} source
 */
export function pickerOptions(sessions, source) {
  const group = (id) => { const s = source(id); return s?.origin === 'session' ? 2 : s?.freshness === 'stale' ? 1 : 0; };
  const names = ['Verified Ship work', 'Checks need refreshing', 'Other sessions · add evidence yourself'];
  return [...sessions].sort((a, b) => group(a.id) - group(b.id)).map(s => ({ title: s.title || 'Untitled session', value: s.id, category: names[group(s.id)] }));
}
