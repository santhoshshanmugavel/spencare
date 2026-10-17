import { useEffect, useState } from "react";
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
import { useAuth } from "@/lib/auth";

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
      await verifyMfa(challengeToken, code.trim());
      router.replace("/(protected)/home");
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
                <ActivityIndicator color="#fff" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  form: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4, color: "#1e293b" },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 8, lineHeight: 20 },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 4,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 18,
    letterSpacing: 2,
    backgroundColor: "#f8fafc",
    color: "#1e293b",
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorBoxFatal: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 14,
  },
  button: {
    height: 48,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  backLink: { alignItems: "center", marginTop: 8, padding: 8 },
  backLinkText: { color: "#64748b", fontSize: 14 },
});
