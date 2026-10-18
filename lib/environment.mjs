/** Return a copy of an environment without the optional runtime transport token. */
export function withoutRuntimeGithubToken(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') delete clean[key];
  }
  return clean;
}
