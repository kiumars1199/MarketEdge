"use client";

// Header search with suggestions (docs/13 § Suggestions as you type). "/" focuses it. Opens on focus with recent
// searches, saved views and popular topics; every keystroke asks /api/suggest (80 ms debounce, previous request
// aborted). ↑/↓ move, Enter picks (or searches), Esc closes, Tab completes the highlighted team. Under 768 px it
// becomes a full-screen sheet. Enter on Best bets or All markets searches that page; elsewhere All markets.
// The URL keeps the raw query (?q=barcelona+3x), so searches are shareable and savable as views.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { softNav } from "@/lib/softNav";
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchEventBySlug, fetchSuggest, type SuggestResponse } from "@/lib/api";
import { formatCount, pays, sideRet } from "@/lib/format";
import { useCollection } from "@/lib/repo/hooks";
import { SLUG_URL } from "@/lib/search/parse";
import { viewById, viewHref } from "@/lib/views";

const RECENT_KEY = "me:recent-searches";
const POPULAR = [
  { id: "sports.nfl", label: "NFL" }, { id: "sports.soccer", label: "Soccer" },
  { id: "weather", label: "Weather" }, { id: "crypto.bitcoin", label: "Bitcoin" },
];
const MAX_Q = 120;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch { /* private mode: recent searches just aren't kept */ }
}

type Item =
  | { kind: "recent"; label: string }
  | { kind: "view"; label: string; href: string }
  | { kind: "entity"; label: string; meta: string }
  | { kind: "topic"; label: string; id: string; meta: string }
  | { kind: "market"; label: string; id: string; side: 0 | 1; meta: string }
  | { kind: "all"; label: string };

/** Bold the letters of `label` that start a typed word ("bar" → **Bar**celona). */
function Highlight({ label, q }: { label: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (!words.length) return <>{label}</>;
  const rx = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{label.split(rx).map((part, i) => (i % 2 ? <mark key={i} className="bg-transparent font-semibold text-accent-hover">{part}</mark> : part))}</>;
}

export function SearchCombobox() {
  return (
    <Suspense fallback={<div className="h-11 w-full max-w-[340px] rounded-input border border-border bg-input" />}>
      <Combobox />
    </Suspense>
  );
}

function Combobox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const here = pathname === "/" || pathname === "/markets";
  const view = pathname === "/" ? "flags" : "markets";
  const presets = useCollection("presets");

  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [text, setText] = useState(urlQ);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [res, setRes] = useState<SuggestResponse | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => setText(urlQ), [urlQ]);
  useEffect(() => setRecent(readRecent()), []);

  // "/" and Cmd/Ctrl+K focus the search (Shortcuts.tsx leaves both to us); Cmd/Ctrl+K works even from another field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // suggestions: 80 ms debounce, abort the previous request
  const typed = text.trim();
  useEffect(() => {
    if (!open || !typed || SLUG_URL.test(typed)) return setRes(null);
    const ac = new AbortController();
    const t = setTimeout(() => fetchSuggest(typed.slice(0, MAX_Q), view, { signal: ac.signal }).then(setRes, () => {}), 80);
    return () => (clearTimeout(t), ac.abort());
  }, [typed, open, view]);

  const items = useMemo<Item[]>(() => {
    if (!typed) {
      const views = presets.slice(0, 3).flatMap((p) => {
        const v = viewById(p.id, presets);
        return v ? [{ kind: "view" as const, label: v.name, href: viewHref(v.state) }] : [];
      });
      return [
        ...recent.map((label) => ({ kind: "recent" as const, label })),
        ...views,
        ...POPULAR.map((t) => ({ kind: "topic" as const, label: t.label, id: t.id, meta: "" })),
      ];
    }
    const r = res?.q === typed.slice(0, MAX_Q) ? res : null;
    const low = typed.toLowerCase();
    const views = presets.filter((p) => p.name.toLowerCase().includes(low)).slice(0, 1).flatMap((p) => {
      const v = viewById(p.id, presets);
      return v ? [{ kind: "view" as const, label: v.name, href: viewHref(v.state) }] : [];
    });
    return [
      ...(r?.entities ?? []).map((e) => ({ kind: "entity" as const, label: e.name, meta: `${formatCount(e.count)} open · best ${sideRet({ roi_pct: e.best_roi, ranges: e.ranges })}` })),
      ...(r?.topics ?? []).map((t) => ({ kind: "topic" as const, label: t.label, id: t.id, meta: `${formatCount(t.count)} open` })),
      ...(r?.markets ?? []).map((m) => ({
        kind: "market" as const, label: m.question, id: m.id, side: m.side_index,
        meta: `${m.outcome} · Pays ${pays(m.pays ? 1 / m.pays : null)} · ${sideRet(m)}`,
      })),
      ...views,
      { kind: "all" as const, label: typed },
    ].slice(-10);
  }, [typed, res, recent, presets]);

  useEffect(() => setActive(-1), [typed]);

  const remember = (q: string) => {
    const next = [q, ...recent.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    setRecent(next);
    writeRecent(next);
  };

  /** Search: put q in the URL of this page (Best bets / All markets) or go to All markets. */
  const commit = useCallback((raw: string) => {
    const q = raw.trim().slice(0, MAX_Q);
    setOpen(false);
    input.current?.blur();
    if (q) remember(q);
    const p = new URLSearchParams(here ? params : undefined);
    for (const k of ["pg", "m", "side"]) p.delete(k);
    if (q) p.set("q", q);
    else p.delete("q");
    const qs = p.toString();
    const href = `${here ? pathname : "/markets"}${qs ? `?${qs}` : ""}`;
    if (here) softNav(href);
    else router.push(href, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, params, pathname, router, recent]);

  const jump = async (raw: string) => {
    const slug = SLUG_URL.exec(raw)?.[1];
    if (!slug) return false;
    setNote("Finding that market…");
    try {
      const ev = await fetchEventBySlug(slug.toLowerCase());
      const best = ev.markets[0];
      if (!best) throw new Error("empty");
      setNote("");
      setOpen(false);
      router.push(`/markets?q=${encodeURIComponent(ev.slug)}&m=${best.id}&side=${best.best.side_index}`);
    } catch {
      setNote("That market isn't open in our scan.");
    }
    return true;
  };

  /** Replace the free text of the query with a team, keep the rest ("bar 3x" → "FC Barcelona 3x"). */
  const withEntity = (name: string) => {
    const words = text.trim().split(/\s+/);
    const rest = words.filter((w) => /\d|^(good|great|best|safe|likely|today|tonight|tomorrow|live|favorites?|underdogs?)$/i.test(w));
    return [name, ...rest].join(" ");
  };

  const pick = (it: Item) => {
    switch (it.kind) {
      case "recent": return (setText(it.label), commit(it.label));
      case "all": return SLUG_URL.test(it.label) ? void jump(it.label) : commit(it.label);
      case "entity": { const q = withEntity(it.label); setText(q); return commit(q); }
      case "topic": {
        const q = [...text.trim().split(/\s+/).slice(0, -1), it.label.toLowerCase().replace(/ & /g, " and ")].join(" ").trim();
        setText(q);
        return commit(q);
      }
      case "view": setOpen(false); return router.push(it.href);
      case "market": {
        setOpen(false);
        const p = new URLSearchParams(here ? params : undefined);
        p.set("m", it.id);
        p.set("side", String(it.side));
        return here ? softNav(`${pathname}?${p}`) : router.push(`/markets?${p}`, { scroll: false });
      }
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const n = items.length;
      if (n) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (open && it) pick(it);
      else if (SLUG_URL.test(typed)) void jump(typed);
      else commit(text);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else input.current?.blur();
    } else if (e.key === "Tab" && !e.shiftKey && open) {
      const it = items[active] ?? items.find((x) => x.kind === "entity");
      if (it?.kind === "entity") {
        e.preventDefault();
        setText(withEntity(it.label) + " ");
      }
    }
  };

  const groups: [string, Item["kind"][]][] = typed
    ? [["Teams & players", ["entity"]], ["Topics", ["topic"]], ["Markets", ["market"]], ["Your saved views", ["view"]], ["", ["all"]]]
    : [["Recent searches", ["recent"]], ["Your saved views", ["view"]], ["Popular topics", ["topic"]]];
  const optId = (i: number) => `${listId}-o${i}`;
  const line = typed && res?.q === typed.slice(0, MAX_Q) ? res.line : "";

  return (
    <div
      ref={box}
      role="search"
      className={open
        ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-4 md:relative md:inset-auto md:z-40 md:block md:w-full md:max-w-[340px] md:bg-transparent md:p-0"
        : "relative w-full max-w-[340px]"}
    >
      <div className="flex items-center gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2.5 rounded-input border border-border bg-input px-3.5 text-muted transition-colors duration-150 focus-within:border-accent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="sr-only">Search markets</span>
          <input
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
            type="search"
            name="q"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={500}
            value={text}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setNote("");
              setText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={onKey}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (SLUG_URL.test(pasted)) {
                e.preventDefault();
                setText(pasted);
                void jump(pasted);
              }
            }}
            placeholder="Search a team, city or “3x”"
            className="w-full min-w-0 text-ellipsis bg-transparent text-text placeholder:text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" aria-label="Clear search" onClick={() => (setText(""), input.current?.focus())} className="-mr-1.5 flex size-8 items-center justify-center rounded-full text-muted hover:text-text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
          {!open && <kbd className="hidden rounded border border-border px-1.5 text-xs md:inline" aria-hidden="true">/</kbd>}
        </label>
        {open && (
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-1 text-sm text-accent-hover md:hidden">Cancel</button>
        )}
      </div>

      {note && <p role="status" className="mt-1 rounded-input border border-border bg-raised px-3 py-1.5 text-xs text-soft md:absolute md:left-0 md:top-full md:z-30">{note}</p>}

      {open && items.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:absolute md:right-0 md:top-[calc(100%+6px)] md:w-[min(520px,calc(100vw-2rem))] md:rounded-card md:border md:border-border md:bg-surface">
          {line && (
            <p className="border-b border-border px-4 py-2.5 text-[13px] text-muted" data-testid="search-line">
              Searching <span className="text-accent-softer">{line}</span>
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="Search suggestions" className="min-h-0 flex-1 overflow-y-auto py-1.5 md:max-h-[min(70vh,560px)]">
            {groups.map(([title, kinds]) => {
              const rows = items.map((it, i) => [it, i] as const).filter(([it]) => kinds.includes(it.kind));
              if (!rows.length) return null;
              return (
                <li key={title || "all"} role="presentation">
                  {title && (
                    <div className="flex items-center justify-between px-4 pb-1 pt-2.5 text-xs font-medium text-muted">
                      <span>{title}</span>
                      {kinds[0] === "recent" && (
                        <button type="button" onClick={() => (setRecent([]), writeRecent([]))} className="min-h-8 px-1 hover:text-text">Clear</button>
                      )}
                    </div>
                  )}
                  <ul role="presentation">
                    {rows.map(([it, i]) => (
                      <li
                        key={i}
                        id={optId(i)}
                        role="option"
                        aria-selected={i === active}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => pick(it)}
                        onMouseMove={() => setActive(i)}
                        className={`mx-1.5 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-sm ${i === active ? "bg-accent-bg" : ""} ${it.kind === "all" ? "mt-1 border-t border-border text-accent-hover" : "text-text"}`}
                      >
                        <span className="min-w-0 truncate">
                          {it.kind === "all" ? <>Search {view === "flags" && here ? "best bets" : "all markets"} for “{it.label}”</> : <Highlight label={it.label} q={typed} />}
                        </span>
                        {"meta" in it && it.meta && <span className="shrink-0 text-xs tabular-nums text-muted">{it.meta}</span>}
                        {it.kind === "all" && <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-xs text-muted md:inline" aria-hidden="true">Enter</kbd>}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
