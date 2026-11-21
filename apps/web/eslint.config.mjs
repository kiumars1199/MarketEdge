// ESLint flat config (T-62). eslint-config-next 15 ships eslintrc presets, so FlatCompat bridges them.
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // `const { omitted, ...rest } = obj` is how this codebase drops a key; the omitted name is unused on purpose.
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }] } },
];

export default config;
