import { redirect } from "next/navigation";
import { getOAuthClientPublicInfo, type McpScope } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { allowAuthorizationAction, denyAuthorizationAction } from "./actions";

/**
 * The MCP OAuth consent screen (Phase 27 §30) -- the one page a real
 * customer sees when connecting Spencare to Claude/ChatGPT/any other MCP
 * client. Reached only through the normal session gate (middleware.ts
 * deliberately does NOT list `/oauth/authorize` as self-authenticating),
 * so an unauthenticated visitor is already sent to
 * `/login?redirect=/oauth/authorize?...` and lands back here signed in --
 * this page does not implement its own login redirect, it relies on that
 * gate having already run.
 *
 * Fails closed, in order, before ever rendering a consent form: malformed
 * request parameters, an unregistered `client_id`, and a `redirect_uri`
 * not on that client's own registered allow-list -- the last of those is
 * the one that matters most, since rendering a consent screen for an
 * unvalidated redirect would let an "Allow" click send a real
 * authorization code to an attacker's URL.
 */
const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  read: "Balances, budgets, goals, bills, transactions, and cash flow.",
  write: "Propose expenses, income, contributions, and budgets -- every write still needs your explicit confirmation inside the AI assistant before anything is recorded.",
};

export default async function OAuthAuthorizePage(props: PageProps<"/oauth/authorize">) {
  const params = await props.searchParams;
  const clientId = typeof params.client_id === "string" ? params.client_id : null;
  const redirectUri = typeof params.redirect_uri === "string" ? params.redirect_uri : null;
  const responseType = typeof params.response_type === "string" ? params.response_type : null;
  const scopeParam = typeof params.scope === "string" ? params.scope : "read";
  const state = typeof params.state === "string" ? params.state : null;
  const codeChallenge = typeof params.code_challenge === "string" ? params.code_challenge : null;
  const codeChallengeMethod = typeof params.code_challenge_method === "string" ? params.code_challenge_method : null;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Defense in depth only -- middleware should already have redirected
    // an unauthenticated visitor to /login before this ever renders.
    redirect(`/login?redirect=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`)}`);
  }

  if (!clientId || !redirectUri || responseType !== "code" || !codeChallenge || codeChallengeMethod !== "S256") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Invalid authorization request</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This request is missing required parameters (client_id, redirect_uri, response_type=code, and a PKCE
          code_challenge are all required). Nothing was shared -- try connecting again from the app you were setting up.
        </CardContent>
      </Card>
    );
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const clientInfo = await getOAuthClientPublicInfo(serviceRoleSupabase, clientId);
  if (!clientInfo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Unknown app</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This app isn&apos;t registered with Spencare. Nothing was shared -- try connecting again from the app you were
          setting up.
        </CardContent>
      </Card>
    );
  }
  if (!clientInfo.redirectUris.includes(redirectUri)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Can&apos;t verify this app</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This app&apos;s redirect address doesn&apos;t match what&apos;s registered with Spencare. Nothing was shared
          -- try connecting again from the app you were setting up.
        </CardContent>
      </Card>
    );
  }

  const requestedScopes = scopeParam
    .split(" ")
    .filter((s): s is McpScope => s === "read" || s === "write");
  const scopes: McpScope[] = requestedScopes.length > 0 ? requestedScopes : ["read"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connect Spencare to {clientInfo.clientName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as <span className="font-medium text-foreground">{user.email}</span>. Allowing this
          connection lets {clientInfo.clientName} do the following with your Spencare account:
        </p>

        <dl className="space-y-4">
          {scopes.includes("read") ? (
            <div>
              <dt className="text-sm font-medium text-foreground">Read</dt>
              <dd className="text-sm text-muted-foreground">{SCOPE_DESCRIPTIONS.read}</dd>
            </div>
          ) : null}
          {scopes.includes("write") ? (
            <div>
              <dt className="text-sm font-medium text-foreground">Write</dt>
              <dd className="text-sm text-muted-foreground">{SCOPE_DESCRIPTIONS.write}</dd>
            </div>
          ) : null}
        </dl>

        <p className="text-xs text-muted-foreground">
          You can revoke this connection at any time from Settings -&gt; MCP.
        </p>

        <div className="flex gap-3">
          <form action={denyAuthorizationAction} className="flex-1">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="redirectUri" value={redirectUri} />
            {state ? <input type="hidden" name="state" value={state} /> : null}
            <Button type="submit" variant="outline" size="touch" className="w-full">
              Cancel
            </Button>
          </form>
          <form action={allowAuthorizationAction} className="flex-1">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="redirectUri" value={redirectUri} />
            {state ? <input type="hidden" name="state" value={state} /> : null}
            <input type="hidden" name="codeChallenge" value={codeChallenge} />
            <input type="hidden" name="scope" value={scopes.join(" ")} />
            <Button type="submit" size="touch" className="w-full">
              Allow access
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
