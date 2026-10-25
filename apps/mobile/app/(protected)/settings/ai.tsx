import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { api, type AiProviderStatusResponse } from "@/lib/api";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";

const PROVIDERS = [
  { id: "google", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic Claude" },
  { id: "openai", label: "OpenAI" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

export default function AiProviderScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [status, setStatus] = useState<AiProviderStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Connect / rotate form
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await api.getAiProvider(session.accessToken);
      setStatus(res);
    } catch {
      Alert.alert("Error", "Couldn't load AI provider status.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  const handleConnect = useCallback(async () => {
    if (!session || !apiKeyInput.trim()) return;
    setSaving(true);
    try {
      const res = await api.connectAiProvider(selectedProvider, apiKeyInput.trim(), session.accessToken);
      setStatus(res);
      setApiKeyInput("");
      Alert.alert("Connected", `${PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? selectedProvider} connected successfully.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to connect. Check your API key and try again.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  }, [session, selectedProvider, apiKeyInput]);

  const handleRotate = useCallback(async () => {
    if (!session || !apiKeyInput.trim()) return;
    setSaving(true);
    try {
      const res = await api.updateAiProviderKey(apiKeyInput.trim(), session.accessToken);
      setStatus(res);
      setApiKeyInput("");
      Alert.alert("Updated", "API key updated successfully.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to update key.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  }, [session, apiKeyInput]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      "Disconnect AI Provider",
      "Spensa will stop working until you connect a new provider. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            if (!session) return;
            try {
              await api.disconnectAiProvider(session.accessToken);
              setStatus({ connected: false });
              Alert.alert("Disconnected", "AI provider removed.");
            } catch {
              Alert.alert("Error", "Couldn't disconnect.");
            }
          },
        },
      ],
    );
  }, [session]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: "AI Provider" }} />
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  const isConnected = status?.connected === true;
  const connectedLabel = isConnected
    ? PROVIDERS.find((p) => p.id === status?.provider)?.label ?? status?.provider
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: "AI Provider" }} />

      {/* Current status */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Current Provider</Text>
        {isConnected ? (
          <>
            <Text style={styles.value}>{connectedLabel}</Text>
            <Text style={styles.meta}>Key ending ···{status?.keyLastFour}</Text>
            {status?.lastValidationError ? (
              <Text style={styles.errorText}>{status.lastValidationError}</Text>
            ) : null}
            <TouchableOpacity style={styles.destructiveButton} onPress={handleDisconnect}>
              <Text style={styles.destructiveButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.meta}>No provider connected. Spensa needs an AI provider key to work.</Text>
        )}
      </View>

      {/* Connect / rotate form */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{isConnected ? "Switch Provider or Rotate Key" : "Connect a Provider"}</Text>

        {/* Provider picker — always shown so the user can connect or switch */}
        <View style={styles.providerRow}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.providerChip, selectedProvider === p.id && styles.providerChipActive]}
              onPress={() => setSelectedProvider(p.id)}
            >
              <Text style={[styles.providerChipText, selectedProvider === p.id && styles.providerChipTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder="Paste your API key here"
          placeholderTextColor={t.foregroundSubtle}
          value={apiKeyInput}
          onChangeText={setApiKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.primaryButton, (!apiKeyInput.trim() || saving) && styles.primaryButtonDisabled]}
          onPress={handleConnect}
          disabled={!apiKeyInput.trim() || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {isConnected && status?.provider === selectedProvider ? "Update Key" : isConnected ? `Switch to ${PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? selectedProvider}` : "Connect"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    center: { justifyContent: "center", alignItems: "center" },
    content: { padding: spacing.md, gap: spacing.md },
    card: {
      backgroundColor: t.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    sectionTitle: {
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
      color: t.foregroundMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    value: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: t.foreground },
    meta: { fontSize: typography.size.sm, color: t.foregroundMuted },
    errorText: { fontSize: typography.size.sm, color: t.destructive },
    providerRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    providerChip: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    providerChipActive: { backgroundColor: t.primary, borderColor: t.primary },
    providerChipText: { fontSize: typography.size.xs, color: t.foregroundMuted },
    providerChipTextActive: { color: "#fff" },
    input: {
      fontSize: typography.size.base,
      color: t.foreground,
      backgroundColor: t.background,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    primaryButton: {
      backgroundColor: t.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
    },
    primaryButtonDisabled: { opacity: 0.5 },
    primaryButtonText: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: "#fff" },
    destructiveButton: {
      borderWidth: 1,
      borderColor: t.destructive,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      marginTop: spacing.xs,
    },
    destructiveButtonText: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: t.destructive },
  });
}
