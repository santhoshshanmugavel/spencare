"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertTriangle, Sparkles, MessageSquarePlus } from "lucide-react";
import type { AccountRow, CategoryRow, GoalRow } from "@spencare/domain-application";
import type { AiConversationRow, AiMessageRow } from "@spencare/ai";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConsequentialActionPreview, type ActionPreview, type ConsequentialActionState } from "@/components/spencare/consequential-action-preview";
import { confirmCommandAction, cancelCommandAction } from "../actions";

/**
 * `<SpensaChat>` -- Phase 16's chat UI (locked decision §17: "build the
 * missing Spensa UI"). No source screen mockup exists for this exact
 * surface (screen-catalog.md's own words for the standalone route) --
 * every element here is RECOMMENDED/INFERRED from the architecture and
 * this codebase's existing design system, deliberately NOT reproducing
 * the SP-053/SP-056/SP-276/SP-277 anti-patterns: there is no silent
 * commit, no fake progress, no ambiguous "this looks like navigation but
 * actually mutates" quick reply anywhere in this file.
 */

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  kind: "text" | "tool_status" | "proposal" | "error";
  text?: string;
  toolName?: string;
  isError?: boolean;
  proposal?: { confirmationId: string; summary: string; fields: { label: string; value: string }[]; expiresAt: string };
}

function toDisplayMessages(rows: AiMessageRow[]): DisplayMessage[] {
  return rows.flatMap((m): DisplayMessage[] => {
    const content = m.content;
    if (content.kind === "text") return [{ id: m.id, role: m.role, kind: "text", text: content.text }];
    if (content.kind === "error") return [{ id: m.id, role: "assistant", kind: "error", text: content.message }];
    if (content.kind === "confirmation_reference") {
      const preview = content.preview as { summary: string; fields: { label: string; value: string }[]; expiresAt: string };
      return [{ id: m.id, role: "assistant", kind: "proposal", proposal: { confirmationId: content.confirmationId, summary: preview.summary, fields: preview.fields, expiresAt: preview.expiresAt } }];
    }
    return [];
  });
}

export function SpensaChat({
  conversationId,
  initialMessages,
  conversations,
  accounts,
  categories,
  goals,
}: {
  conversationId: string | null;
  initialMessages: AiMessageRow[];
  conversations: AiConversationRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  goals: GoalRow[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<DisplayMessage[]>(toDisplayMessages(initialMessages));
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [pendingToolName, setPendingToolName] = useState<string | null>(null);
  const [confirmStates, setConfirmStates] = useState<Record<string, { state: ConsequentialActionState; errorMessage?: string }>>({});
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Accounts/categories/goals are fetched here so the confirmation
  // preview can render human-readable names -- Spensa's own tool layer
  // already does the same lookups server-side for the preview text it
  // generates; these are used only if a client-side re-render needs them,
  // never to compute a financial figure.
  void accounts;
  void categories;
  void goals;

  async function handleSend() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", kind: "text", text: content }]);
    setIsStreaming(true);
    setStreamingText("");
    setPendingToolName(null);

    const response = await fetch("/api/spensa/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, content }),
    });

    if (!response.body) {
      setIsStreaming(false);
      setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", kind: "error", text: "Spensa is unavailable right now." }]);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "conversation_created") {
          router.replace(`/spensa/${event.conversationId}`);
        } else if (event.type === "text_delta") {
          finalText += event.text;
          setStreamingText(finalText);
        } else if (event.type === "tool_call_started") {
          setPendingToolName(event.toolName);
        } else if (event.type === "tool_call_result") {
          setPendingToolName(null);
        } else if (event.type === "proposal") {
          setMessages((m) => [...m, { id: `proposal-${event.confirmationId}`, role: "assistant", kind: "proposal", proposal: event }]);
          setConfirmStates((s) => ({ ...s, [event.confirmationId]: { state: "proposed" } }));
        } else if (event.type === "error") {
          setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", kind: "error", text: event.message }]);
        } else if (event.type === "message_complete") {
          // Snapshot into a local BEFORE resetting `finalText` -- the
          // updater passed to setMessages is only actually invoked once
          // React processes the update, by which point the very next line
          // would already have mutated the outer `finalText` variable
          // (closures capture the binding, not a value) if referenced
          // directly.
          const completedText = finalText;
          setMessages((m) => [...m, { id: event.messageId, role: "assistant", kind: "text", text: completedText }]);
          finalText = "";
          setStreamingText("");
        }
      }
    }

    setIsStreaming(false);
    setPendingToolName(null);
  }

  function handleConfirm(confirmationId: string) {
    setConfirmStates((s) => ({ ...s, [confirmationId]: { state: "confirming" } }));
    startTransition(async () => {
      const result = await confirmCommandAction(confirmationId);
      if (result.ok) {
        setConfirmStates((s) => ({ ...s, [confirmationId]: { state: "confirmed" } }));
      } else {
        setConfirmStates((s) => ({ ...s, [confirmationId]: { state: "error", errorMessage: result.error.message } }));
      }
    });
  }

  function handleCancel(confirmationId: string) {
    startTransition(async () => {
      await cancelCommandAction(confirmationId);
      setConfirmStates((s) => ({ ...s, [confirmationId]: { state: "cancelled" } }));
    });
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 p-3 md:flex" aria-label="Conversation history">
        <Button asChild variant="outline" size="touch" className="mb-3 w-full justify-start gap-2">
          <Link href="/spensa/new">
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            New chat
          </Link>
        </Button>
        <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Past conversations">
          {conversations.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <Link
                key={c.id}
                href={`/spensa/${c.id}`}
                className={`block truncate rounded-lg px-2 py-2 text-sm ${c.id === conversationId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
                aria-current={c.id === conversationId ? "page" : undefined}
              >
                {c.title ?? "New conversation"}
              </Link>
            ))
          )}
        </nav>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6" role="log" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && !isStreaming ? (
            <div className="mx-auto max-w-md space-y-3 py-12 text-center">
              <Sparkles className="mx-auto size-8 text-primary" aria-hidden="true" />
              <h1 className="text-xl font-semibold text-foreground">Ask Spensa</h1>
              <p className="text-sm text-muted-foreground">Ask about your Safe-to-Spend, budgets, goals, or bills -- or ask Spensa to log an expense (you&apos;ll always confirm before anything is recorded).</p>
            </div>
          ) : null}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} confirmState={m.proposal ? confirmStates[m.proposal.confirmationId] : undefined} onConfirm={handleConfirm} onCancel={handleCancel} />
          ))}

          {isStreaming ? (
            <div className="flex justify-start">
              <Card className="max-w-[80%]">
                <CardContent className="space-y-1 py-3">
                  {pendingToolName ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-label={`Checking ${pendingToolName}`}>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Checking your data…
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {streamingText || (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          Thinking…
                        </span>
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border/60 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <label htmlFor="spensa-composer" className="sr-only">
            Message Spensa
          </label>
          <textarea
            id="spensa-composer"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask Spensa..."
            rows={1}
            className="min-h-11 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            disabled={isStreaming}
          />
          <Button type="submit" size="touch" disabled={isStreaming || isPending || !input.trim()}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  confirmState,
  onConfirm,
  onCancel,
}: {
  message: DisplayMessage;
  confirmState?: { state: ConsequentialActionState; errorMessage?: string };
  onConfirm: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
}) {
  if (message.kind === "proposal" && message.proposal) {
    const preview: ActionPreview = {
      commandType: "spensaProposal",
      summary: message.proposal.summary,
      fields: message.proposal.fields.map((f) => ({ label: f.label, value: f.value })),
      // Undo is not wired up from the chat surface in this phase --
      // reporting undoable:false here is the honest choice (the
      // underlying transaction/contribution/budget/goal CAN still be
      // reversed through its own normal Web UI screen, just not via a
      // one-click Undo from this chat message yet).
      undoable: false,
    };
    return (
      <div className="flex justify-start">
        <ConsequentialActionPreview
          preview={preview}
          state={confirmState?.state ?? "proposed"}
          expiresAt={new Date(message.proposal.expiresAt)}
          errorMessage={confirmState?.errorMessage}
          onConfirm={() => onConfirm(message.proposal!.confirmationId)}
          onCancel={() => onCancel(message.proposal!.confirmationId)}
          className="max-w-[80%]"
        />
      </div>
    );
  }

  if (message.kind === "error") {
    return (
      <div className="flex justify-start">
        <Card className="max-w-[80%] border-destructive/40">
          <CardContent className="flex items-start gap-2 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">{message.text}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <span className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">{message.text}</span>
      ) : (
        <div className="flex max-w-[80%] items-start gap-2">
          <Sparkles className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="whitespace-pre-wrap text-sm text-foreground">{message.text}</p>
        </div>
      )}
    </div>
  );
}
