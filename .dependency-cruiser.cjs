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
      name: "no-mcp-imports-ai",
      comment:
        "MCP server must not depend on packages/ai at all (mcp-architecture.md §1's own layering diagram " +
        "excludes it entirely -- packages/ai transitively depends on domain-infra, which apps/mcp-server may " +
        "never reach). This direct-edge rule, combined with no-mcp-direct-infra/no-mcp-direct-database above, " +
        "fully closes the transitive path a future contributor could otherwise take (apps/mcp-server -> " +
        "packages/ai -> domain-infra -> supabase-js) without needing dependency-cruiser's reachability-rule " +
        "syntax. The confirmation cascade and any AI-adjacent helper apps/mcp-server needs lives in " +
        "packages/domain/application instead (Phase 18 locked decision #2).",
      severity: "error",
      from: { path: "^apps/mcp-server" },
      to: { path: ["^packages/ai"] },
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
          "@google/genai",
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
    {
      name: "ai-provider-sdk-only-in-adapters",
      comment:
        "A provider SDK (ai-architecture.md §1) may only be imported inside packages/ai/src/adapters -- " +
        "orchestration, tools, context, and confirmation code are written entirely against the " +
        "AiProviderAdapter interface and must never import a provider SDK directly.",
      severity: "error",
      from: { path: "^packages/ai/src", pathNot: "^packages/ai/src/adapters" },
      to: {
        path: ["@anthropic-ai", "openai", "@google/generative-ai", "@google/genai"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
