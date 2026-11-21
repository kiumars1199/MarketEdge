// Side-effect module: `import "@/lib/zod-jitless";` as the first import of every schema module the browser loads.
// In the browser, zod v4 probes `new Function("")` (a JIT fast path) when the first z.object() is built. Our CSP has
// no 'unsafe-eval', so the probe is blocked and reported as a CSP violation (Lighthouse Best Practices) and costs
// main-thread time for nothing. jitless skips it; it must be set before any schema is built (test/zod-jitless.test.ts).
// Server keeps the JIT: it validates the 20 MB scan (lib/data/store.ts) and allows eval.
// Imports zod/v4/core (the instance "zod" uses), not "zod": that kept webpack from tree-shaking zod (+250 kB).
import { config } from "zod/v4/core";

if (typeof window !== "undefined") config({ jitless: true });
