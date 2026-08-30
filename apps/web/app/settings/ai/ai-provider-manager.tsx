"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { connectProviderSchema, updateProviderKeySchema, type ConnectProviderInput, type UpdateProviderKeyInput, type AiProviderValue } from "@spencare/validation";
import type { AiProviderStatus } from "@spencare/ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, errorId } from "@/components/spencare/form-field";
import { ConfirmDialog } from "@/components/spencare/confirm-dialog";
import { toastConfirmed, toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { connectProviderAction, switchProviderAction, updateProviderKeyAction, disconnectProviderAction } from "../actions";

/**
 * <AiProviderManager> -- Phase 17's BYO AI settings state machine, built
 * following the same shape as `<TwoFactorManager>` (a multi-step secret
 * flow: select/enter -> validate -> connected, with an explicit
 * confirmation gate for the destructive action). No screen mockup shows
 * this exact combined-states layout at any breakpoint other than Desktop
 * (SP-311-SP-316/344/346) -- the specific state transitions here are
 * RECOMMENDED/INFERRED from those screens plus the locked Phase 17
 * authorization, not a pixel-for-pixel reproduction.
 */

// ai-architecture.md §1's terminology table -- the DB enum uses
// vendor identifiers, product-facing copy uses product names.
const PROVIDER_LABELS: Record<AiProviderValue, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  google: "Gemini",
  openrouter: "OpenRouter",
  other: "Other",
};

function maskedKeyDisplay(keyLastFour: string): string {
  return `•••• •••• •••• ${keyLastFour}`;
}

type ViewState = { step: "idle" } | { step: "updating" };

export function AiProviderManager({
  initialStatus,
  providers,
  implementedProviders,
}: {
  initialStatus: AiProviderStatus | null;
  providers: readonly AiProviderValue[];
  implementedProviders: readonly AiProviderValue[];
}) {
  const [status, setStatus] = useState<AiProviderStatus | null>(initialStatus);
  const [view, setView] = useState<ViewState>({ step: "idle" });
  const [selectedProvider, setSelectedProvider] = useState<AiProviderValue>(status?.provider ?? providers[0]!);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const connectForm = useForm<ConnectProviderInput>({
    resolver: zodResolver(connectProviderSchema),
    defaultValues: { provider: selectedProvider, apiKey: "" },
  });
  const updateForm = useForm<UpdateProviderKeyInput>({
    resolver: zodResolver(updateProviderKeySchema),
    defaultValues: { apiKey: "" },
  });

  function isImplemented(provider: AiProviderValue) {
    return implementedProviders.includes(provider);
  }

  function selectProvider(provider: AiProviderValue) {
    if (!isImplemented(provider)) return; // structurally unreachable via the disabled radio input; defensive no-op
    setSelectedProvider(provider);
    connectForm.reset({ provider, apiKey: "" });
  }

  const isConnectedToSelected = status !== null && status.provider === selectedProvider;
  const showConnectForm = !isConnectedToSelected && view.step === "idle";

  async function onConnectSubmit(data: ConnectProviderInput) {
    const isSwitch = status !== null && status.provider !== data.provider;
    const result = await (isSwitch ? switchProviderAction(data) : connectProviderAction(data));
    if (!result.ok) {
      connectForm.setError("apiKey", { message: result.error.message });
      return;
    }
    setStatus(result.status);
    connectForm.reset({ provider: result.status.provider, apiKey: "" });
    toastConfirmed(`Connected to ${PROVIDER_LABELS[result.status.provider]}.`);
  }

  async function onUpdateSubmit(data: UpdateProviderKeyInput) {
    const result = await updateProviderKeyAction(data);
    if (!result.ok) {
      updateForm.setError("apiKey", { message: result.error.message });
      return;
    }
    setStatus(result.status);
    setView({ step: "idle" });
    updateForm.reset({ apiKey: "" });
    toastConfirmed("Your API key was updated.");
  }

  async function onDisconnectConfirm() {
    setDisconnecting(true);
    try {
      await disconnectProviderAction();
      setStatus(null);
      setView({ step: "idle" });
      setDisconnectOpen(false);
      toastConfirmed("Disconnected. Spensa will need a new provider connection.");
    } catch {
      toastError("Couldn't disconnect right now. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-foreground">AI Provider</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {providers.map((provider) => {
            const implemented = isImplemented(provider);
            const checked = selectedProvider === provider;
            return (
              <label
                key={provider}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors",
                  checked ? "border-primary ring-1 ring-primary" : "border-border",
                  !implemented && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="ai-provider"
                    value={provider}
                    checked={checked}
                    disabled={!implemented}
                    onChange={() => selectProvider(provider)}
                    className="size-4"
                  />
                  {PROVIDER_LABELS[provider]}
                </span>
                {!implemented ? <Badge variant="secondary">Coming soon</Badge> : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      {isConnectedToSelected && status ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-success text-success">
                Active
              </Badge>
              <span className="text-sm text-muted-foreground">{PROVIDER_LABELS[status.provider]} is connected.</span>
            </div>
            <p className="font-mono text-sm tabular-nums text-foreground" aria-label="Connected API key, masked">
              {maskedKeyDisplay(status.keyLastFour)}
            </p>
            {view.step === "idle" ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="touch" onClick={() => setView({ step: "updating" })}>
                  Update API key
                </Button>
                <Button variant="destructive" size="touch" onClick={() => setDisconnectOpen(true)}>
                  Disconnect
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {view.step === "updating" && status ? (
        <Card>
          <CardContent className="space-y-3 py-5">
            <p className="text-sm text-muted-foreground">
              Enter a new API key for {PROVIDER_LABELS[status.provider]}. Your current key keeps working until the
              new one is verified.
            </p>
            <form onSubmit={updateForm.handleSubmit(onUpdateSubmit)} noValidate className="space-y-3">
              <FormField id="updateApiKey" label="New API key" error={updateForm.formState.errors.apiKey?.message}>
                <Input
                  id="updateApiKey"
                  type="password"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  aria-invalid={!!updateForm.formState.errors.apiKey}
                  aria-describedby={updateForm.formState.errors.apiKey ? errorId("updateApiKey") : undefined}
                  {...updateForm.register("apiKey")}
                />
              </FormField>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                Encrypted before it&apos;s stored. Never shown again after you save it.
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="touch" disabled={updateForm.formState.isSubmitting}>
                  {updateForm.formState.isSubmitting ? "Verifying…" : "Update key"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="touch"
                  onClick={() => {
                    setView({ step: "idle" });
                    updateForm.reset({ apiKey: "" });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {showConnectForm ? (
        <Card>
          <CardContent className="space-y-3 py-5">
            <form onSubmit={connectForm.handleSubmit(onConnectSubmit)} noValidate className="space-y-3">
              <FormField id="connectApiKey" label="API Key" error={connectForm.formState.errors.apiKey?.message}>
                <Input
                  id="connectApiKey"
                  type="password"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  aria-invalid={!!connectForm.formState.errors.apiKey}
                  aria-describedby={connectForm.formState.errors.apiKey ? errorId("connectApiKey") : undefined}
                  {...connectForm.register("apiKey")}
                />
              </FormField>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                Encrypted before it&apos;s stored. Never shown again after you save it.
              </div>
              <Button type="submit" size="touch" disabled={connectForm.formState.isSubmitting}>
                {connectForm.formState.isSubmitting ? "Activating…" : "Activate Spensa brain"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect AI provider?"
        description="Disconnecting removes your stored API key completely. Spensa will stop working until you connect another provider."
        consequences={["Chat with Spensa", "Smart insights and recommendations", "Spending analysis and summaries"]}
        confirmLabel={disconnecting ? "Disconnecting…" : "Disconnect"}
        confirmDisabled={disconnecting}
        onConfirm={onDisconnectConfirm}
      />
    </div>
  );
}
