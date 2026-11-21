// FilterState <-> URL query (docs/04 § URL encoding). Short keys, defaults omitted, arrays comma-joined,
// booleans 1/0, sort "key.dir". parse() ignores unknown keys and drops invalid values (falls back to default).
import { FilterState, defaultState } from "./state";
import { KEYS } from "./keys";
export { KEYS };

const DEFAULTS = defaultState();
const sortStr = (s: FilterState["sort"]) => `${s.key}.${s.dir}`;

export function serialize(f: FilterState): URLSearchParams {
  const out = new URLSearchParams();
  for (const [short, [field, kind]] of Object.entries(KEYS)) {
    const v = f[field];
    if (v === undefined) continue;
    if (field === "sort") {
      if (sortStr(f.sort) !== sortStr(DEFAULTS.sort)) out.set(short, sortStr(f.sort));
      continue;
    }
    if (v === DEFAULTS[field]) continue;
    if (kind === "list") out.set(short, (v as string[]).join(","));
    else if (kind === "bool") out.set(short, v ? "1" : "0");
    else out.set(short, String(v));
  }
  return out;
}

export const toQuery = (f: FilterState) => {
  const s = serialize(f).toString();
  return s ? `?${s}` : "";
};

export function parse(input: URLSearchParams | string | Record<string, string | string[] | undefined>): FilterState {
  const params =
    input instanceof URLSearchParams ? input
    : typeof input === "string" ? new URLSearchParams(input)
    : new URLSearchParams(Object.entries(input).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v]])));
  const shape = FilterState.shape;
  const obj: Record<string, unknown> = {};
  for (const [short, [field, kind]] of Object.entries(KEYS)) {
    const raw = params.get(short);
    if (raw === null) continue;
    let v: unknown;
    if (field === "sort") {
      const [key, dir] = raw.split(".");
      v = { key, dir };
    } else if (kind === "list") v = raw.split(",").filter(Boolean);
    else if (kind === "bool") v = raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : undefined;
    else if (kind === "num") v = raw.trim() === "" ? undefined : Number(raw);
    else v = raw;
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    if (shape[field].safeParse(v).success) obj[field] = v;
  }
  return FilterState.parse(obj);
}

/** QA-A #47: the URL asked for a sort parse() can't use ("s=bogus.up"); the page falls back to its default order and
 *  says so instead of silently ignoring it. */
export function sortRejected(input: URLSearchParams): boolean {
  const raw = input.get("s");
  if (raw === null) return false;
  const [key, dir] = raw.split(".");
  return !FilterState.shape.sort.safeParse({ key, dir }).success;
}
