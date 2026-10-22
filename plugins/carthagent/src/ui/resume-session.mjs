/** Resolve session IDs independently of the host's title-oriented search filter. */
export async function findNativeResumeSession({ query, directory, client, pageSize = 100 }) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return undefined;
  const isSessionID = /^ses(?:sion)?[_-]/i.test(query.trim());

  if (isSessionID) {
    try {
      const exact = await client.session.get({ sessionID: query.trim() });
      if (exact && !exact.parentID && exact.location.directory === directory) return exact;
    } catch { /* non-exact IDs continue as prefix search */ }
  }

  const loadPages = async (search) => {
    const sessions = [];
    let cursor;
    do {
      const page = await client.session.list({
        limit: pageSize, order: 'desc', directory,
        ...(cursor ? { cursor } : {}), ...(search ? { search } : {}),
      });
      sessions.push(...page.data.filter((session) => !session.parentID));
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
    return sessions;
  };

  const unfiltered = await loadPages();
  if (isSessionID) {
    const prefix = unfiltered.find((session) => session.id.toLowerCase().startsWith(normalized));
    if (prefix) return prefix;
  }
  return (await loadPages(query)).find((session) => (session.title ?? '').toLowerCase().includes(normalized));
}
