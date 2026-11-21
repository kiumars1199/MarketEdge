import { expect, it } from "vitest";
import type { ApiRow, MarketsResponse } from "@/lib/api";
import { getStore } from "@/lib/data/store";
import { cell, collectRows, MAX_ROWS, toCsv } from "./csv";

it("escapes commas, quotes and line breaks; blanks missing values", () => {
  expect(cell("plain")).toBe("plain");
  expect(cell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
  expect(cell("a\nb")).toBe('"a\nb"');
  expect(cell(null)).toBe("");
  expect(cell(NaN)).toBe("");
  expect(cell(0)).toBe("0");
});

it("writes a header and plain-language cells", async () => {
  const m = (await getStore()).markets[0];
  const csv = toCsv([{ market: { ...m, question: 'Will "X", win?' }, side: m.best }]);
  const [head, row] = csv.split("\r\n");
  expect(head.startsWith("Question,Event,Bet,Estimated return")).toBe(true);
  expect(row.startsWith('"Will ""X"", win?"')).toBe(true);
  expect(row).not.toMatch(/NaN|undefined|null/);
});

it("stops at the 5,000-row cap and at the last page", async () => {
  const fake = (total: number) => async (page: number): Promise<MarketsResponse> => {
    const size = 200, pages = Math.ceil(total / size);
    const n = Math.max(0, Math.min(size, total - (page - 1) * size));
    return { total, page, page_size: size, pages, rows: Array.from({ length: n }, () => ({}) as ApiRow), facets: {} as MarketsResponse["facets"] };
  };
  let calls = 0;
  const counted = (f: ReturnType<typeof fake>) => (p: number) => { calls++; return f(p); };
  expect(await collectRows(counted(fake(5001)))).toHaveLength(MAX_ROWS);
  expect(calls).toBe(25);
  expect(await collectRows(fake(450))).toHaveLength(450);
  const m = (await getStore()).markets[0];
  expect(toCsv(Array.from({ length: MAX_ROWS + 3 }, () => ({ market: m, side: m.best }))).split("\r\n")).toHaveLength(MAX_ROWS + 1);
});

// RT3-04: upstream text (question, event, outcome) must never run as a spreadsheet formula.
it("neutralizes formula cells; numbers stay numbers", async () => {
  for (const s of ["=HYPERLINK(\"http://x\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"])
    expect(cell(s).replace(/^"/, "")).toMatch(/^'/);
  expect(cell(-0.05)).toBe("-0.05");
  expect(cell("Will X win?")).toBe("Will X win?");
  const m = (await getStore()).markets[0];
  const row = toCsv([{ market: { ...m, question: "=1+1", event: "@x" }, side: m.best }]).split("\r\n")[1];
  expect(row.startsWith("'=1+1,'@x,")).toBe(true);
});
