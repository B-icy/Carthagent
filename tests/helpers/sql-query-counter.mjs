const EXECUTING_METHODS = new Set(['run', 'get', 'all', 'iterate']);

export const normalizeSql = sql => String(sql).replace(/\s+/g, ' ').trim();

// Counts statements executed through one node:sqlite DatabaseSync instance.
// Each run/get/all/iterate call on a prepared statement and each exec() call
// counts once, keyed by normalized SQL.
export function countQueries(db) {
  const counts = new Map();
  const record = sql => {
    const key = normalizeSql(sql);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const originalPrepare = db.prepare;
  const originalExec = db.exec;

  db.prepare = function prepare(sql, ...rest) {
    const statement = originalPrepare.call(db, sql, ...rest);
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!EXECUTING_METHODS.has(property)) return value.bind(target);
        return (...args) => {
          record(sql);
          return value.apply(target, args);
        };
      },
    });
  };
  db.exec = function exec(sql) {
    record(sql);
    return originalExec.call(db, sql);
  };

  const counter = {
    get total() {
      let total = 0;
      for (const count of counts.values()) total += count;
      return total;
    },
    statements: () => Object.fromEntries(counts),
    reset: () => counts.clear(),
    measure(callback) {
      counts.clear();
      const result = callback();
      return { result, total: counter.total, statements: counter.statements() };
    },
    restore() {
      delete db.prepare;
      delete db.exec;
    },
  };
  return counter;
}
