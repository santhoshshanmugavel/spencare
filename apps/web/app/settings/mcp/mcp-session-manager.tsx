"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Lock } from "lucide-react";
import type { McpScope, McpSessionStatus } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, errorId } from "@/components/spencare/form-field";
import { ConfirmDialog } from "@/components/spencare/confirm-dialog";
import { toastConfirmed, toastError } from "@/lib/toast";
import { createMcpSessionAction, revokeMcpSessionAction } from "../actions";

/**
 * <McpSessionManager> -- Phase 18 decision #3's minimum secure token
 * lifecycle UI, built following the same shape as `<AiProviderManager>`
 * (Phase 17): a plain form for the consequential "create" step, an
 * explicit one-time-reveal state for the secret, and a `ConfirmDialog`
 * gate for the destructive "revoke" action. `createMcpSessionAction`'s
 * plaintext `token` is held ONLY in this component's local state, and
 * ONLY until the user dismisses the reveal panel (`onDismissReveal`) --
 * after that it is gone from memory for the rest of the session; there is
 * no "show again" affordance anywhere, and `listMcpSessionsAction` /
 * the initial server-fetched `initialSessions` never carry one.
 */

const SCOPE_OPTIONS: { value: McpScope; label: string; hint: string }[] = [
  { value: "read", label: "Read", hint: "Balances, budgets, goals, bills, transactions." },
  { value: "write", label: "Write", hint: "Propose expenses, income, contributions -- every write still needs your confirmation." },
];

function sessionState(session: McpSessionStatus): "active" | "revoked" | "expired" {
  if (session.revokedAt) return "revoked";
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) return "expired";
  return "active";
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function McpSessionManager({ initialSessions, mcpServerUrl = "" }: { initialSessions: McpSessionStatus[]; mcpServerUrl?: string }) {
  const [sessions, setSessions] = useState<McpSessionStatus[]>(initialSessions);
  const [clientName, setClientName] = useState("");
  const [scopes, setScopes] = useState<Record<McpScope, boolean>>({ read: true, write: false });
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<McpSessionStatus | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function onCopyUrl() {
    try {
      await navigator.clipboard.writeText(mcpServerUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toastError("Couldn't copy automatically — select and copy the URL manually.");
    }
  }

  function toggleScope(scope: McpScope) {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }

  async function onCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = clientName.trim();
    const selectedScopes = SCOPE_OPTIONS.map((o) => o.value).filter((scope) => scopes[scope]);
    if (!trimmedName) {
      setFormError("Give this token a name so you can recognize it later.");
      return;
    }
    if (selectedScopes.length === 0) {
      setFormError("Choose at least one permission.");
      return;
    }
    setFormError(undefined);
    setCreating(true);
    try {
      const result = await createMcpSessionAction({ clientName: trimmedName, scopes: selectedScopes });
      setSessions((prev) => [result.session, ...prev]);
      setRevealedToken(result.token);
      setClientName("");
      setScopes({ read: true, write: false });
    } catch {
      toastError("Couldn't generate a token right now. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function onCopyToken() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError("Couldn't copy automatically -- select and copy the token manually.");
    }
  }

  function onDismissReveal() {
    // The only copy of the plaintext token that will ever exist leaves memory here.
    setRevealedToken(null);
    setCopied(false);
  }

  async function onRevokeConfirm() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeMcpSessionAction(revokeTarget.id);
      setSessions((prev) =>
        prev.map((s) => (s.id === revokeTarget.id ? { ...s, revokedAt: new Date().toISOString() } : s)),
      );
      toastConfirmed(`Revoked access for ${revokeTarget.clientName}.`);
      setRevokeTarget(null);
    } catch {
      toastError("Couldn't revoke that token right now. Try again.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Server URL + connection guidance */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connect an AI assistant</h2>
          <div className="flex-1 h-px bg-border" />
        </div>
        <p className="text-xs text-muted-foreground">
          Use this remote MCP server URL with any compatible AI assistant or MCP client.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
            {mcpServerUrl}
          </code>
          <Button type="button" variant="outline" size="icon" onClick={onCopyUrl} aria-label="Copy server URL">
            {copiedUrl ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          </Button>
        </div>
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground">
            How to connect with Claude
          </summary>
          <ol className="space-y-1 px-4 pb-3 pt-2 text-xs text-muted-foreground list-decimal list-inside">
            <li>Open Claude and go to its MCP / connector settings.</li>
            <li>Add a remote MCP server and paste the URL above.</li>
            <li>Complete Spencare authorization when prompted.</li>
            <li>Approve the requested permissions.</li>
            <li>Return to Claude and try: &ldquo;Show my account balances.&rdquo;</li>
          </ol>
        </details>
      </div>

      {revealedToken ? (
        <Card className="border-primary">
          <CardContent className="space-y-3 py-5">
            <p className="text-sm font-medium text-foreground">Your new token</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
                {revealedToken}
              </code>
              <Button type="button" variant="outline" size="icon" onClick={onCopyToken} aria-label="Copy token">
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              </Button>
            </div>
            <div className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>This is shown once. Copy it now -- you won&apos;t be able to see it again after you leave this screen.</span>
            </div>
            <Button type="button" size="touch" onClick={onDismissReveal}>
              I&apos;ve saved it
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 py-5">
            <form onSubmit={onCreateSubmit} noValidate className="space-y-3">
              <FormField id="mcpClientName" label="Client name" error={formError && !clientName.trim() ? formError : undefined}>
                <Input
                  id="mcpClientName"
                  placeholder="e.g. Claude Desktop"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  aria-invalid={!!formError}
                  aria-describedby={formError ? errorId("mcpClientName") : undefined}
                />
              </FormField>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">Permissions</legend>
                {SCOPE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={scopes[option.value]}
                      onChange={() => toggleScope(option.value)}
                      className="mt-0.5 size-4"
                    />
                    <span>
                      <span className="block font-medium text-foreground">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {formError && clientName.trim() ? (
                <p className="text-xs text-destructive" role="alert">
                  {formError}
                </p>
              ) : null}

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                Shown once, right after you generate it. We never store or display it again.
              </div>

              <Button type="submit" size="touch" disabled={creating}>
                {creating ? "Generating…" : "Generate token"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active tokens</h2>
          <div className="flex-1 h-px bg-border" />
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => {
              const state = sessionState(session);
              return (
                <li key={session.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{session.clientName}</span>
                          {state === "active" ? (
                            <Badge variant="outline" className="border-success text-success">
                              Active
                            </Badge>
                          ) : state === "expired" ? (
                            <Badge variant="secondary">Expired</Badge>
                          ) : (
                            <Badge variant="destructive">Revoked</Badge>
                          )}
                          {session.scopes.map((scope) => (
                            <Badge key={scope} variant="secondary">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Created {formatTimestamp(session.createdAt)} &middot; Last used {formatTimestamp(session.lastUsedAt)}
                          {session.expiresAt ? <> &middot; Expires {formatTimestamp(session.expiresAt)}</> : null}
                        </p>
                      </div>
                      {state === "active" ? (
                        <Button variant="destructive" size="touch" onClick={() => setRevokeTarget(session)}>
                          Revoke
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this token?"
        description={
          revokeTarget
            ? `${revokeTarget.clientName} will immediately lose access to your data. This can't be undone.`
            : undefined
        }
        confirmLabel={revoking ? "Revoking…" : "Revoke"}
        confirmDisabled={revoking}
        onConfirm={onRevokeConfirm}
      />
    </div>
  );
}
