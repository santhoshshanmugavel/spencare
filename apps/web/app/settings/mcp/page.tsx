import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { listMcpSessions, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { McpSessionManager } from "./mcp-session-manager";

/**
 * `/settings/mcp` -- Phase 18 decision #3's minimum secure MCP token
 * management surface. Follows the exact same shell/fetch pattern as
 * `/settings/ai` (Phase 17): a Server Component resolves `AuthContext`
 * from the verified session, fetches the initial (token-free) session
 * list server-side, and hands it to a "use client" manager component as a
 * plain serializable prop. No plaintext token ever passes through this
 * page -- `listMcpSessions` never returns one (mcpSessionsRepo.ts's
 * `McpSessionStatus` view has no `token_hash`/token field at all).
 *
 * There is no dedicated screen mockup or DDG step for this surface
 * (flagged MISSING during Phase 18 reconnaissance) -- layout here follows
 * the existing Settings visual pattern per Decision 3 rather than any
 * screen-literal design.
 */
export default async function McpSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
  const sessions = await listMcpSessions(ctx);

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={[
            { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
            {
              key: "settings",
              label: "Settings",
              icon: <SettingsIcon className="size-5" />,
              href: "/settings/profile",
              active: true,
            },
          ]}
        />
      }
    >
      <div className="mx-auto max-w-xl space-y-6 py-8">
        <h1 className="text-2xl font-semibold text-foreground">MCP Access</h1>
        <p className="text-sm text-muted-foreground">
          Generate a token to let an MCP client (like Claude Desktop) read your finances or
          propose changes on your behalf. Every write still needs your explicit confirmation --
          nothing is ever applied automatically.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <McpSessionManager initialSessions={sessions} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
