import { describe, expect, it } from "vitest";
import { capError, feeCents, maxCostCents, orderBody, orderView, parseIntent, scopeError, toQuote, type OrderIntent } from "../src/kalshi/trade";

const o: OrderIntent = { ticker: "KXHIGHCHI-26NOV17-B56.5", side: "yes", price_cents: 61, count: 10, client_order_id: "3f1c2a9e-1b2c-4d5e-8f90-123456789abc" };

describe("scopes (docs/15: read + write::trade only)", () => {
  it("accepts read + write::trade", () => expect(scopeError(["read", "write::trade"])).toBeNull());
  it("rejects full write and transfer", () => {
    expect(scopeError(["read", "write"])).toMatch(/write/);
    expect(scopeError(["read", "write::trade", "write::transfer"])).toMatch(/write::transfer/);
    expect(scopeError(["read", "write::trade", "write::fcm_risk"])).toMatch(/fcm_risk/);
  });
  it("RT-09: allow-list, case- and spacing-proof: any other scope is refused", () => {
    for (const s of ["WRITE::TRANSFER", "transfer", "write:transfer", "admin", "*", "write::*", "write:trade", " Write::Transfer ", "read:*"])
      expect(scopeError(["read", "write::trade", s]), s).not.toBeNull();
    expect(scopeError([" READ ", "Write::Trade", "read::portfolio_balance"])).toBeNull();
  });
  it("requires read and write::trade", () => {
    expect(scopeError(["write::trade"])).toMatch(/read/);
    expect(scopeError(["read::portfolio_balance", "write::trade"])).toMatch(/read/);
    expect(scopeError(["read"])).toMatch(/can't place orders/);
  });
});

describe("intent", () => {
  it("accepts a valid intent and drops unknown fields", () => {
    expect(parseIntent({ ...o, extra: 1 })).toEqual(o);
  });
  it.each([
    [{ ...o, price_cents: 0 }], [{ ...o, price_cents: 100 }], [{ ...o, price_cents: 61.5 }], [{ ...o, count: 0 }],
    [{ ...o, side: "maybe" }], [{ ...o, ticker: "../x" }], [{ ...o, client_order_id: "1" }], [null],
  ])("rejects %j", (bad) => expect(typeof parseIntent(bad)).toBe("string"));
});

describe("money", () => {
  it("fee estimate rounds up to the cent", () => {
    expect(feeCents(10, 61)).toBe(17); // 0.07×10×0.61×0.39 = 0.1665 → 17¢
    expect(feeCents(100, 50)).toBe(175);
    expect(feeCents(1, 1)).toBe(1);
  });
  it("max cost = count × limit + fee", () => expect(maxCostCents(o)).toBe(610 + 17));
  it("caps per order and per day", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(capError(o, { maxOrderUsd: 25, maxDayUsd: 100 }, undefined, now)).toBeNull();
    expect(capError(o, { maxOrderUsd: 5, maxDayUsd: 100 }, undefined, now)).toMatch(/per-order/);
    expect(capError(o, { maxOrderUsd: 25, maxDayUsd: 10 }, { day: "2026-11-17", cents: 500 }, now)).toMatch(/daily/);
    expect(capError(o, { maxOrderUsd: 25, maxDayUsd: 10 }, { day: "2026-11-16", cents: 900 }, now)).toBeNull(); // new day
  });
});

describe("order body (Kalshi V2: YES book only)", () => {
  it("buy YES = bid at the price", () =>
    expect(orderBody(o)).toMatchObject({ side: "bid", price: "0.6100", count: "10.00", time_in_force: "good_till_canceled", client_order_id: o.client_order_id }));
  it("buy NO at 39¢ = sell YES at 61¢", () => expect(orderBody({ ...o, side: "no", price_cents: 39 })).toMatchObject({ side: "ask", price: "0.6100" }));
});

describe("order view", () => {
  it("maps status and fills", () => {
    expect(orderView({ order_id: "a", ticker: "T", status: "resting", outcome_side: "yes", fill_count_fp: "0.00", remaining_count_fp: "10.00" }).state).toBe("resting");
    const p = orderView({ order_id: "a", ticker: "T", status: "resting", outcome_side: "yes", fill_count_fp: "4.00", remaining_count_fp: "6.00", taker_fill_cost_dollars: "2.4400", taker_fees_dollars: "0.07" });
    expect(p).toMatchObject({ state: "partial", filled: 4, remaining: 6, avg_price_cents: 61, fees_cents: 7 });
    expect(orderView({ order_id: "a", ticker: "T", status: "executed", fill_count_fp: "10.00", remaining_count_fp: "0.00" }).state).toBe("filled");
    expect(orderView({ order_id: "a", ticker: "T", status: "canceled", fill_count_fp: "0", remaining_count_fp: "0" }).state).toBe("cancelled");
  });
});

describe("quote", () => {
  it("reads asks from the other side's bids (cents and dollar formats)", () => {
    const q1 = toQuote({ ticker: "T", title: "t", yes_ask: 62, no_ask: 40 }, { orderbook: { yes: [[58, 100], [59, 20]], no: [[38, 50], [37, 10]] } });
    expect(q1.yes_ask).toBe(62);
    expect(q1.asks.yes).toEqual([[62, 50], [63, 10]]);
    expect(q1.asks.no).toEqual([[41, 20], [42, 100]]);
    const q2 = toQuote({ ticker: "T", yes_ask_dollars: "0.6200" }, { orderbook_fp: { no_dollars: [["0.3800", "50.00"]] } });
    expect(q2.yes_ask).toBe(62);
    expect(q2.asks.yes).toEqual([[62, 50]]);
  });
});
