type UpdateResult = { status: string; release: { version: string; tag: string }; method?: string };
type UpdateOptions = { args: string[]; cwd: string; root: string; io: Console };
type UpdateRunner = (options?: UpdateOptions) => Promise<UpdateResult>;

/** UI adapter: preserve native updater semantics while forwarding honest progress. */
export async function runNativeUpdateForUI({
  args,
  cwd,
  root,
  runUpdate,
  onProgress,
}: {
  args: string[];
  cwd: string;
  root: string;
  runUpdate: UpdateRunner;
  onProgress: (message: string, level: "log" | "error") => void;
}) {
  const io = Object.assign(Object.create(console), {
    log: (...values: unknown[]) => onProgress(values.map(String).join(" "), "log"),
    error: (...values: unknown[]) => onProgress(values.map(String).join(" "), "error"),
  }) as Console;
  return runUpdate({ args, cwd, root, io });
}
