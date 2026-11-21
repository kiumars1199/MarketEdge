// Audit run 2 fail 6: Lighthouse mobile performance >= 90 on /, /about and /pricing. The wins were keeping the
// site-wide hosts and telemetry out of first paint and hydration. These source checks keep them out.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(path.resolve(import.meta.dirname, "..", p), "utf8");
const HOSTS = ["DrawerHost", "Shortcuts", "TicketHost", "ComboTray", "AlertRunner", "AuthBoot", "DisplayEffects"];

describe("first-load JS budget", () => {
  it("the root layout mounts the site-wide hosts only through LazyHosts", () => {
    const layout = src("app/layout.tsx");
    expect(layout).toMatch(/<LazyHosts \/>/);
    for (const h of HOSTS) expect(layout, h).not.toMatch(new RegExp(`import \\{[^}]*\\b${h}\\b`));
  });

  it("LazyHosts loads every host with next/dynamic and no SSR", () => {
    const lazy = src("components/shell/LazyHosts.tsx");
    expect(lazy).not.toMatch(/^import (?!dynamic from "next\/dynamic")/m);
    for (const h of HOSTS) {
      expect(lazy, h).toMatch(new RegExp(`const ${h} = dynamic\\(\\(\\) => import\\([^)]*\\)\\.then\\(\\(m\\) => m\\.${h}\\), \\{ ssr: false \\}\\)`));
      expect(lazy, h).toMatch(new RegExp(`<${h} />`));
    }
  });

  // Audit run 3 fail 5: cards, the header bell and the screeners imported drawerHref from DrawerHost, which put
  // MarketDetail in every page's first load. Only DrawerGate loads DrawerHost, lazily, when ?m is set.
  it("no module imports DrawerHost statically; DrawerGate loads it only for ?m", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && /^import [^;]*from "(@\/components\/market|\.)\/DrawerHost"/m.test(readFileSync(p, "utf8"))) bad.push(path.relative(root, p));
      }
    };
    for (const d of ["app", "components", "lib"]) walk(path.join(root, d));
    expect(bad).toEqual([]);
    const gate = src("components/market/DrawerGate.tsx");
    expect(gate).toMatch(/dynamic\(\(\) => import\("\.\/DrawerHost"\)/);
    expect(gate).toMatch(/useSearchParams\(\)\.(has|get)\("m"\)/);   // T-276: get, to send a signed-out ?m to sign-up
  });

  it("Sentry and PostHog start when the page is idle, not at load", () => {
    const boot = src("instrumentation-client.ts");
    expect(boot).not.toMatch(/^import .*@sentry\/nextjs/m);
    expect(boot).toMatch(/requestIdleCallback/);
    expect(boot).toMatch(/whenIdle\(\(\) => \{[\s\S]*import\("@sentry\/nextjs"\)[\s\S]*initAnalytics\(\)[\s\S]*\}\);/);
  });
});
