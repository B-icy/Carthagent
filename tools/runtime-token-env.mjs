/** Return a child environment without the optional runtime-download credential. */
export function withoutRuntimeGithubToken(env) {
  const sanitized = { ...env };
  for (const key of Object.keys(sanitized)) {
    if (key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') delete sanitized[key];
  }
  return sanitized;
}
