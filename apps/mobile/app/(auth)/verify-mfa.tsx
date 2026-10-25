import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth, checkOnboarding } from "@/lib/auth";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";

// Maps server error messages to user-safe display text.
function classifyError(raw: string): { message: string; fatal: boolean } {
  const lower = raw.toLowerCase();
  if (lower.includes("expired") || lower.includes("invalid or expired")) {
    return {
      message: "This verification session has expired. Please sign in again.",
      fatal: true,
    };
  }
  if (lower.includes("already used") || lower.includes("sign in again")) {
    return {
      message: "This verification session has already been used. Please sign in again.",
      fatal: true,
    };
  }
  if (lower.includes("too many")) {
    return { message: "Too many attempts. Please wait and try again.", fatal: false };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return { message: "Unable to connect. Check your network and try again.", fatal: false };
  }
  // Default: wrong code — safe generic message.
  return { message: "That code isn't valid. Check your authenticator app and try again.", fatal: false };
}

export default function VerifyMfaScreen(): React.JSX.Element {
  const { verifyMfa } = useAuth();
  const { challengeToken } = useLocalSearchParams<{ challengeToken: string }>();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFatal, setIsFatal] = useState(false);

  // If no challenge token was passed (e.g. direct navigation), return to sign-in.
  useEffect(() => {
    if (!challengeToken) {
      router.replace("/(auth)/sign-in");
    }
  }, [challengeToken]);

  if (!challengeToken) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  async function handleVerify(): Promise<void> {
    if (!code.trim() || loading || isFatal) return;

    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await verifyMfa(challengeToken, code.trim());
      const dest = await checkOnboarding(accessToken);
      router.replace(dest === "incomplete" ? "/onboarding" : "/(protected)/home");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      const { message, fatal } = classifyError(raw);
      setError(message);
      setIsFatal(fatal);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Two-factor verification</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code from your authenticator app, or a backup code.
        </Text>

        {error ? (
          <View
            style={[styles.errorBox, isFatal && styles.errorBoxFatal]}
            accessibilityRole="alert"
          >
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!isFatal ? (
          <>
            <View>
              <Text style={styles.label} nativeID="codeLabel">
                Verification code
              </Text>
              <TextInput
                style={styles.input}
                placeholder="123456 or XXXX-XXXX"
                placeholderTextColor={t.foregroundSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                accessibilityLabel="Verification code"
                accessibilityLabelledBy="codeLabel"
                value={code}
                onChangeText={(v) => {
                  setCode(v);
                  if (error) setError(null);
                }}
                onSubmitEditing={handleVerify}
                autoFocus
                editable={!loading}
                returnKeyType="done"
              />
            </View>

            <TouchableOpacity
              style={[styles.button, (loading || !code.trim()) && styles.buttonDisabled]}
              onPress={handleVerify}
              disabled={loading || !code.trim()}
              accessibilityRole="button"
              accessibilityLabel="Verify"
              accessibilityState={{ disabled: loading || !code.trim(), busy: loading }}
            >
              {loading ? (
                <ActivityIndicator color={t.primaryForeground} />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>
          </>
        ) : null}

        <TouchableOpacity
          style={styles.backLink}
          onPress={() => router.replace("/(auth)/sign-in")}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
        >
          <Text style={styles.backLinkText}>
            {isFatal ? "Return to sign in" : "Back to sign in"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    form: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
      gap: spacing.md,
    },
    title: {
      fontSize: typography.size["2xl"],
      fontWeight: typography.weight.bold,
      marginBottom: spacing.xs,
      color: t.foreground,
    },
    subtitle: {
      fontSize: typography.size.base,
      color: t.foregroundMuted,
      marginBottom: spacing.sm,
      lineHeight: 20,
    },
    label: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.medium,
      color: t.foreground,
      marginBottom: spacing.xs,
    },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: typography.size.xl,
      letterSpacing: 2,
      backgroundColor: t.backgroundSubtle,
      color: t.foreground,
    },
    errorBox: {
      backgroundColor: t.destructiveSubtle,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: t.destructiveBorder,
    },
    errorBoxFatal: {
      backgroundColor: t.warningSubtle,
      borderColor: t.warning,
    },
    errorText: {
      color: t.destructive,
      fontSize: typography.size.base,
    },
    button: {
      height: 48,
      backgroundColor: t.primary,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.sm,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      color: t.primaryForeground,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
    },
    backLink: { alignItems: "center", marginTop: spacing.sm, padding: spacing.sm },
    backLinkText: { color: t.foregroundMuted, fontSize: typography.size.base },
  });
}
