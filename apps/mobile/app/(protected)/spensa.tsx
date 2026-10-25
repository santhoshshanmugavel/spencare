import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";
import { useTheme, typography } from "../../lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  noProvider?: boolean;
}

// ── SSE parser ────────────────────────────────────────────────────────────────

async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.cancel();
  }
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What's my Safe-to-Spend?",
  "Show my top spending categories",
  "How are my goals going?",
  "Summarize this month's spending",
];

// ── Message bubble ─────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const t = useTheme();
  const isUser = message.role === "user";

  const s = StyleSheet.create({
    row: {
      flexDirection: "row",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
      paddingHorizontal: 16,
    },
    bubble: {
      maxWidth: "80%",
      borderRadius: 16,
      padding: 12,
      backgroundColor: isUser ? t.primary : t.card,
      borderWidth: isUser ? 0 : 1,
      borderColor: t.border,
    },
    text: {
      fontSize: typography.size.sm,
      color: isUser ? "#fff" : t.foreground,
      lineHeight: 20,
    },
    pendingDots: {
      flexDirection: "row",
      gap: 4,
      paddingVertical: 4,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.foregroundMuted,
    },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.primary + "20",
      justifyContent: "center",
      alignItems: "center",
      marginRight: 8,
      alignSelf: "flex-end",
    },
    avatarText: { fontSize: 14 },
    ctaButton: {
      marginTop: 8,
      backgroundColor: t.primary,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      alignItems: "center",
    },
    ctaText: { fontSize: typography.size.sm, color: "#fff", fontWeight: typography.weight.semibold },
  });

  return (
    <View style={s.row}>
      {!isUser && (
        <View style={s.avatar}>
          <Text style={s.avatarText}>✦</Text>
        </View>
      )}
      <View style={s.bubble}>
        {message.pending ? (
          <View style={s.pendingDots}>
            <View style={s.dot} />
            <View style={s.dot} />
            <View style={s.dot} />
          </View>
        ) : (
          <>
            <Text style={s.text}>{message.content}</Text>
            {message.noProvider && (
              <TouchableOpacity
                style={s.ctaButton}
                onPress={() => router.push("/settings/ai" as never)}
              >
                <Text style={s.ctaText}>Set up AI Provider</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SpensaScreen() {
  const { session } = useAuth();
  const t = useTheme();
  const accessToken = session?.accessToken ?? "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversationId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  function genId() {
    return Math.random().toString(36).slice(2);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");

    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      content: text.trim(),
    };

    // Add pending assistant message
    const pendingId = genId();
    const pendingMessage: ChatMessage = {
      id: pendingId,
      role: "assistant",
      content: "",
      pending: true,
    };

    setMessages([...messages, userMessage, pendingMessage]);
    setStreaming(true);

    let aborted = false;
    abortRef.current = () => { aborted = true; };

    try {
      const response = await api.spensaChat(
        { conversationId, content: text.trim() },
        accessToken,
      );

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(errBody || `HTTP ${response.status}`);
      }

      let assistantContent = "";

      for await (const event of parseSSE(response)) {
        if (aborted) break;

        const type = event.type as string | undefined;
        if (type === "text_delta" || type === "content_block_delta") {
          const delta = (event.delta as Record<string, unknown> | undefined)?.text as string ?? "";
          const directText = event.text as string | undefined;
          assistantContent += delta || directText || "";
        } else if (type === "message_delta" || type === "message_stop") {
          // stream ended
        } else if (type === "error") {
          const errMsg = (event.message as string) ?? "AI error";
          const isNoProvider = errMsg.toLowerCase().includes("no ai provider");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? { ...m, content: errMsg, pending: false, noProvider: isNoProvider }
                : m,
            ),
          );
          return;
        }

        // Update the pending message in real-time
        if (assistantContent) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? { ...m, content: assistantContent, pending: false }
                : m,
            ),
          );
        }
      }

      // Finalize
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                ...m,
                content: assistantContent || "(No response)",
                pending: false,
              }
            : m,
        ),
      );
    } catch (err) {
      if (!aborted) {
        const errMsg = err instanceof Error ? err.message : "Something went wrong.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, content: `Error: ${errMsg}`, pending: false }
              : m,
          ),
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.();
  }

  function handleClear() {
    setMessages([]);
    setInput("");
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    header: {
      padding: 20,
      paddingTop: 56,
      backgroundColor: t.card,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatarLarge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.primary,
      justifyContent: "center",
      alignItems: "center",
    },
    avatarLargeText: { fontSize: 18, color: "#fff" },
    title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: t.foreground },
    subtitle: { fontSize: typography.size.xs, color: t.foregroundMuted },
    clearBtn: { padding: 8 },
    clearBtnText: { fontSize: typography.size.sm, color: t.foregroundMuted },
    emptyBox: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 32,
    },
    emptyTitle: {
      fontSize: typography.size.xl,
      fontWeight: typography.weight.bold,
      color: t.foreground,
      marginBottom: 8,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: typography.size.sm,
      color: t.foregroundMuted,
      textAlign: "center",
      marginBottom: 24,
    },
    suggestionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
    suggestionChip: {
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    suggestionText: { fontSize: typography.size.sm, color: t.foreground },
    messageList: { paddingTop: 16, paddingBottom: 8 },
    inputBar: {
      backgroundColor: t.card,
      borderTopWidth: 1,
      borderTopColor: t.border,
      padding: 12,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
    },
    inputWrap: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: t.background,
      minHeight: 40,
      maxHeight: 120,
    },
    inputText: {
      fontSize: typography.size.md,
      color: t.foreground,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.primary,
      justifyContent: "center",
      alignItems: "center",
    },
    sendBtnDisabled: { backgroundColor: t.border },
    sendBtnText: { color: "#fff", fontSize: 18 },
    stopBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#EF4444",
      justifyContent: "center",
      alignItems: "center",
    },
    stopBtnText: { color: "#fff", fontSize: 14, fontWeight: typography.weight.bold },
    disclaimer: {
      fontSize: typography.size.xs,
      color: t.foregroundMuted,
      textAlign: "center",
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
  });

  const canSend = input.trim().length > 0 && !streaming;

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.avatarLarge}>
            <Text style={s.avatarLargeText}>✦</Text>
          </View>
          <View>
            <Text style={s.title}>Spensa</Text>
            <Text style={s.subtitle}>Your financial AI</Text>
          </View>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity style={s.clearBtn} onPress={handleClear}>
            <Text style={s.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Messages or empty state */}
      {messages.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>Hello! I'm Spensa</Text>
          <Text style={s.emptySubtitle}>
            Ask me about your finances, spending patterns, goals, or anything Spencare can help with.
          </Text>
          <View style={s.suggestionGrid}>
            {SUGGESTIONS.map((s_) => (
              <Pressable
                key={s_}
                style={s.suggestionChip}
                onPress={() => sendMessage(s_)}
              >
                <Text style={s.suggestionText}>{s_}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={s.messageList}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Disclaimer */}
      <Text style={s.disclaimer}>
        Spensa may make mistakes. Verify important financial info.
      </Text>

      {/* Input bar */}
      <View style={s.inputBar}>
        <TextInput
          style={s.inputWrap}
          value={input}
          onChangeText={setInput}
          placeholder="Ask Spensa anything…"
          placeholderTextColor={t.foregroundMuted}
          multiline
          editable={!streaming}
          onSubmitEditing={() => sendMessage(input)}
          blurOnSubmit={false}
          returnKeyType="send"
        />
        {streaming ? (
          <TouchableOpacity style={s.stopBtn} onPress={handleStop}>
            <Text style={s.stopBtnText}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.sendBtn, !canSend && s.sendBtnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!canSend}
          >
            <Text style={s.sendBtnText}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
