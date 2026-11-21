// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { can, quota, useEntitlements } from "@/lib/entitlements";
import { UpgradeGate } from "./UpgradeGate";

describe("entitlements", () => {
  it("quotas follow the tier table", () => {
    expect([quota("free", "presets"), quota("pro", "presets"), quota("premium", "presets")]).toEqual([1, 25, Infinity]);
    expect([quota("free", "dashboards"), quota("pro", "dashboards"), quota("premium", "dashboards")]).toEqual([0, 3, Infinity]);
    expect([quota("free", "watchlist"), quota("pro", "watchlist")]).toEqual([10, Infinity]);
    expect([quota("free", "alert_rules"), quota("pro", "alert_rules"), quota("premium", "alert_rules")]).toEqual([0, 20, 100]);
    expect([quota("free", "flags_revealed"), quota("pro", "flags_revealed")]).toEqual([3, Infinity]);
  });

  it("features follow the tier table", () => {
    expect(can("free", "exact_edge")).toBe(false);
    expect(can("pro", "exact_edge")).toBe(true);
    expect(can("pro", "journal")).toBe(true);
    expect(can("pro", "webhooks")).toBe(false);
    expect(can("pro", "extension")).toBe(false);
    expect(can("premium", "extension")).toBe(true);
  });

  it("demo mode is premium", () => {
    let tier = "";
    function Probe() { tier = useEntitlements().tier; return null; }
    render(<Probe />);
    expect(tier).toBe("premium");
  });
});

describe("UpgradeGate", () => {
  it("passes in demo mode", () => {
    render(<UpgradeGate feature="extension"><p>secret</p></UpgradeGate>);
    expect(screen.getByText("secret")).toBeTruthy();
    expect(screen.queryByText(/upgrade/i)).toBeNull();
  });
});
