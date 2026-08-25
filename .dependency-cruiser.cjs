/**
 * Architecture-conformance rules per
 * /docs/architecture/testing-architecture.md §5 and
 * /docs/architecture/system-architecture.md §3.
 *
 * These rules are CI-failing gates, not documentation. They exist so the
 * layering boundary (UI -> Application -> Domain -> Infrastructure -> DB)
 * cannot be silently violated by a future change.
 */
module.exports = {
  forbidden: [
    {
      name: "no-web-ui-direct-database",
      comment:
        "UI components and pages must not import a Supabase client or packages/domain/infra directly. " +
        "All data access goes through packages/domain/application.",
      severity: "error",
      from: { path: "^apps/web/(app|components)" },
      to: {
        path: [
          "@supabase/supabase-js",
          "^packages/domain/infra",
        ],
      },
    },
    {
      name: "no-mcp-direct-database",
      comment:
        "MCP server must not import a Supabase client directly (mcp-architecture.md §6). " +
        "It calls packages/domain/application exclusively.",
      severity: "error",
      from: { path: "^apps/mcp-server" },
      to: { path: ["@supabase/supabase-js"] },
    },
    {
      name: "no-mcp-direct-infra",
      comment: "MCP server must not import packages/domain/infra directly.",
      severity: "error",
      from: { path: "^apps/mcp-server" },
      to: { path: ["^packages/domain/infra"] },
    },
    {
      name: "domain-core-is-pure",
      comment:
        "packages/domain/core must have zero dependency on React, Supabase, or any AI SDK " +
        "(api-architecture.md §8 — Safe-to-Spend must be unit-testable with zero I/O).",
      severity: "error",
      from: { path: "^packages/domain/core" },
      to: {
        path: [
          "^react",
          "@supabase/supabase-js",
          "@anthropic-ai",
          "openai",
          "@google/generative-ai",
        ],
      },
    },
    {
      name: "domain-application-no-react",
      comment: "packages/domain/application is server-side orchestration only, never imports React.",
      severity: "error",
      from: { path: "^packages/domain/application" },
      to: { path: ["^react"] },
    },
    {
      name: "no-circular",
      comment: "No circular dependencies between packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
