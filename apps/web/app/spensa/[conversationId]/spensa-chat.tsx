"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, AlertTriangle, Sparkles, MessageSquarePlus, Send, Bot } from "lucide-react";
import type { AccountRow, CategoryRow, GoalRow } from "@spencare/domain-application";
import type { AiConversationRow, AiMessageRow } from "@spencare/ai";
import { Button } from "@/components/ui/button";
import { ConsequentialActionPreview, type ActionPreview, type ConsequentialActionState } from "@/components/spencare/consequential-action-preview";
import { confirmCommandAction, cancelCommandAction } from "../actions";
import { cn } from "@/lib/utils";

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

const STARTER_PROMPTS = [
  "Add an expense",
  "Add income",
  "Show account balances",
  "See this month's summary",
  "How much can I spend?",
];

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
  void accounts; void categories; void goals;

  const router = useRouter();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId);
  const [messages, setMessages] = useState<DisplayMessage[]>(toDisplayMessages(initialMessages));
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [pendingToolName, setPendingToolName] = useState<string | null>(null);
  const [confirmStates, setConfirmStates] = useState<Record<string, { state: ConsequentialActionState; errorMessage?: string }>>({});
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages or streaming text change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, pendingToolName]);

  // Auto-resize textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  async function handleSend(override?: string) {
    const content = (override ?? input).trim();
    if (!content || isStreaming) return;
    setInput("");
    if (inputRef.current) { inputRef.current.style.height = "auto"; }
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", kind: "text", text: content }]);
    setIsStreaming(true);
    setStreamingText("");
    setPendingToolName(null);

    const response = await fetch("/api/spensa/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: activeConversationId, content }),
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
        let event: Record<string, unknown>;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.type === "conversation_created") {
          setActiveConversationId(event.conversationId as string);
          router.replace(`/spensa/${event.conversationId}`);
        } else if (event.type === "text_delta") {
          finalText += event.text as string;
          setStreamingText(finalText);
        } else if (event.type === "tool_call_started") {
          setPendingToolName(event.toolName as string);
        } else if (event.type === "tool_call_result") {
          setPendingToolName(null);
        } else if (event.type === "proposal") {
          setMessages((m) => [...m, { id: `proposal-${event.confirmationId}`, role: "assistant", kind: "proposal", proposal: event as DisplayMessage["proposal"] }]);
          setConfirmStates((s) => ({ ...s, [event.confirmationId as string]: { state: "proposed" } }));
        } else if (event.type === "error") {
          setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", kind: "error", text: event.message as string }]);
        } else if (event.type === "message_complete") {
          const completedText = finalText;
          if (completedText.trim()) {
            setMessages((m) => [...m, { id: event.messageId as string, role: "assistant", kind: "text", text: completedText }]);
          }
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

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Sidebar — conversation history */}
      <aside
        className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-muted/20 md:flex"
        aria-label="Conversation history"
      >
        <div className="p-3">
          <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2 rounded-lg">
            <Link href="/spensa/new">
              <MessageSquarePlus className="size-4" aria-hidden="true" />
              New chat
            </Link>
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Past conversations">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No conversations yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/spensa/${c.id}`}
                    className={cn(
                      "block truncate rounded-md px-3 py-2 text-sm transition-colors",
                      c.id === conversationId
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground/80 hover:bg-accent hover:text-foreground",
                    )}
                    aria-current={c.id === conversationId ? "page" : undefined}
                  >
                    {c.title ?? "New conversation"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      {/* Main chat area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {isEmpty ? (
            <EmptyState onPrompt={(p) => void handleSend(p)} />
          ) : (
            <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  confirmState={m.proposal ? confirmStates[m.proposal.confirmationId] : undefined}
                  onConfirm={handleConfirm}
                  onCancel={handleCancel}
                />
              ))}

              {/* Live streaming message */}
              {isStreaming ? (
                <StreamingBubble text={streamingText} toolName={pendingToolName} />
              ) : null}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
          <form
            className="mx-auto flex max-w-2xl items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
          >
            <label htmlFor="spensa-composer" className="sr-only">Message Spensa</label>
            <div className="relative flex-1">
              <textarea
                id="spensa-composer"
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Ask Spensa…"
                rows={1}
                style={{ height: "auto" }}
                className={cn(
                  "w-full resize-none rounded-xl border border-input bg-background px-4 py-3 pr-12 text-sm",
                  "leading-relaxed outline-none transition-colors",
                  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
                  "disabled:opacity-50",
                  "min-h-[48px] max-h-40",
                )}
                disabled={isStreaming}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={isStreaming || isPending || !input.trim()}
              className="size-12 shrink-0 rounded-xl"
              aria-label="Send"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
          <p className="mx-auto mt-1.5 max-w-2xl text-center text-[11px] text-muted-foreground/60">
            Shift+Enter for new line · Spensa always asks before recording anything
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-16">
      <div className="mb-6 flex items-center justify-center">
        <img src="/spensa-ai-logo.svg" alt="Spensa AI" width={144} height={37} className="shrink-0" />
      </div>
      <h1 className="mb-2 text-2xl font-semibold text-foreground sr-only">Ask Spensa</h1>
      <p className="mb-8 max-w-sm text-center text-sm text-muted-foreground">
        Ask about your finances, log an expense, or check your goals. Spensa always confirms before recording anything.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className={cn(
              "rounded-full border border-border/80 bg-background px-4 py-2 text-sm text-foreground/80",
              "transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function AiAvatar() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
      <Bot className="size-4 text-primary" />
    </div>
  );
}

function StreamingBubble({ text, toolName }: { text: string; toolName: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <AiAvatar />
      <div className="min-w-0 flex-1 pt-1">
        {toolName ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Checking your data…
          </span>
        ) : text ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p>
        ) : (
          <TypingDots />
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Spensa is thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground/50"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }`}</style>
    </span>
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
      undoable: false,
    };
    return (
      <div className="flex items-start gap-3">
        <AiAvatar />
        <ConsequentialActionPreview
          preview={preview}
          state={confirmState?.state ?? "proposed"}
          expiresAt={new Date(message.proposal.expiresAt)}
          errorMessage={confirmState?.errorMessage}
          onConfirm={() => onConfirm(message.proposal!.confirmationId)}
          onCancel={() => onCancel(message.proposal!.confirmationId)}
          className="flex-1"
        />
      </div>
    );
  }

  if (message.kind === "error") {
    const isNoProvider = message.text?.toLowerCase().includes("connect an ai provider");
    return (
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10" aria-hidden="true">
          <AlertTriangle className="size-4 text-destructive" />
        </div>
        <div className="flex-1 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{message.text}</p>
          {isNoProvider ? (
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href="/settings/ai">Connect a provider</Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
          {message.text}
        </div>
      </div>
    );
  }

  // Assistant text
  return (
    <div className="flex items-start gap-3">
      <AiAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="prose prose-sm max-w-none text-foreground dark:prose-invert
          prose-p:leading-relaxed prose-p:my-1
          prose-headings:font-semibold prose-headings:text-foreground
          prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
          prose-strong:text-foreground prose-strong:font-semibold
          prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-mono prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-muted prose-pre:rounded-lg prose-pre:text-xs
          prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
          prose-hr:border-border prose-hr:my-3
          prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text ?? ""}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
