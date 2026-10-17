import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

export default function VerifyMfaScreen(): React.JSX.Element {
  const { verifyMfa } = useAuth();
  const { challengeToken } = useLocalSearchParams<{ challengeToken: string }>();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleVerify(): Promise<void> {
    if (!code.trim() || !challengeToken) return;
    setLoading(true);
    try {
      await verifyMfa(challengeToken, code.trim());
      router.replace("/(protected)/home");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Verification failed.";
      Alert.alert("Verification failed", message);
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
        <TextInput
          style={styles.input}
          placeholder="123456 or XXXX-XXXX"
          autoCapitalize="none"
          keyboardType="default"
          value={code}
          onChangeText={setCode}
          onSubmitEditing={handleVerify}
          autoFocus
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.backLink}
          onPress={() => router.replace("/(auth)/sign-in")}
        >
          <Text style={styles.backLinkText}>Back to sign in</Text>
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
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 8, lineHeight: 20 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 18,
    letterSpacing: 2,
    backgroundColor: "#f8fafc",
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
  backLink: { alignItems: "center", marginTop: 8 },
  backLinkText: { color: "#64748b", fontSize: 14 },
});
