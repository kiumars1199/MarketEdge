// Wording that promises or projects profit (docs/01 Compliance, audit fail 8). Shared by the wording and email tests.
// Audit run 2 fail 4 added: a bare "expected" label or tooltip (`"expected"`, `>Expected at entry`), "expected"
// right after a figure (`+14% expected`, `${ret(x)} expected`) and "Expected-return". dataKey="expected" is a chart
// series key, not text.
export const PROFIT_CLAIM =
  /expected[\s-](return|profit)|→\s*expect|\bexpect\b[^.\n]{0,20}\$|guaranteed|(?<!dataKey=)["'`>]\s*expected\b|[%¢$}\d]\s*expected\b/i;
