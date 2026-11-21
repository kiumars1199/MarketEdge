// Minimal in-memory stand-in for the supabase-js query builder: just the calls the cron jobs make.
type R = Record<string, unknown>;

export function fakeSupabase(tables: Record<string, R[]>, emails: Record<string, string> = {}) {
  let seq = 1;
  const from = (t: string) => {
    const rows = (tables[t] ??= []);
    const where: ((r: R) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select";
    let body: R = {};
    let single = false;
    const run = () => {
      const hit = rows.filter((r) => where.every((f) => f(r)));
      if (op === "insert") {
        if (t === "alert_events" && rows.some((r) => r.dedupe_key === body.dedupe_key))
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        const row = { id: String(seq++), fired_at: new Date().toISOString(), ...body };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") { hit.forEach((r) => Object.assign(r, body)); return { data: null, error: null }; }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: () => b,
      single: () => { single = true; return b; },
      eq: (k: string, v: unknown) => { where.push((r) => r[k] === v); return b; },
      in: (k: string, vs: unknown[]) => { where.push((r) => vs.includes(r[k])); return b; },
      is: (k: string, v: null) => { where.push((r) => (r[k] ?? null) === v); return b; },
      or: (s: string) => { where.push((r) => s.split(",").some((c) => r[c.split(".")[0]!] == null)); return b; },
      insert: (row: R) => { op = "insert"; body = row; return b; },
      update: (p: R) => { op = "update"; body = p; return b; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  };
  const auth = { admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { id, email: emails[id] } : null }, error: null }) } };
  return { from, auth, tables };
}
