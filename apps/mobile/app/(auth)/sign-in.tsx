import { useMemo, useState } from "react";
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
import { router } from "expo-router";
import { useAuth, checkOnboarding } from "@/lib/auth";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";

function classifyGoogleError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Unable to connect. Check your network and try again.";
  }
  if (lower.includes("too many") || lower.includes("rate limit")) {
    return "Too many attempts. Please wait and try again.";
  }
  return "Sign-in failed. Please try again.";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function SignInScreen(): React.JSX.Element {
  const { signIn, signInWithGoogle } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(): Promise<void> {
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    setLoading(true);
    try {
      const result = await signIn(trimmedEmail, password);
      if (result.requiresMfa) {
        router.replace({
          pathname: "/(auth)/verify-mfa",
          params: { challengeToken: result.challengeToken },
        });
      } else {
        const dest = await checkOnboarding(result.accessToken);
        router.replace(dest === "incomplete" ? "/onboarding" : "/(protected)/home");
      }
    } catch (err: unknown) {
      // Never surface raw server error messages; use a generic message instead.
      const raw = err instanceof Error ? err.message : "";
      if (raw.toLowerCase().includes("network") || raw.toLowerCase().includes("fetch")) {
        setError("Unable to connect. Check your network and try again.");
      } else if (raw.toLowerCase().includes("too many")) {
        setError("Too many attempts. Please wait and try again.");
      } else {
        setError("Invalid email or password.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    if (googleLoading || loading) return;
    setError(null);
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.cancelled) return;
      if (result.requiresMfa) {
        router.replace({
          pathname: "/(auth)/verify-mfa",
          params: { challengeToken: result.challengeToken },
        });
      } else {
        const dest = await checkOnboarding(result.accessToken);
        router.replace(dest === "incomplete" ? "/onboarding" : "/(protected)/home");
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      setError(classifyGoogleError(raw));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.form}>
        <Text style={styles.brand}>Spencare</Text>
        <Text style={styles.tagline}>Personal finance, clearly.</Text>

        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View>
          <Text style={styles.label} nativeID="emailLabel">
            Email
          </Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={t.foregroundSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel="Email address"
            accessibilityLabelledBy="emailLabel"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            editable={!loading}
            returnKeyType="next"
          />
        </View>

        <View>
          <Text style={styles.label} nativeID="passwordLabel">
            Password
          </Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Password"
              placeholderTextColor={t.foregroundSubtle}
              secureTextEntry={!showPassword}
              textContentType="password"
              accessibilityLabel="Password"
              accessibilityLabelledBy="passwordLabel"
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (error) setError(null);
              }}
              onSubmitEditing={handleSignIn}
              editable={!loading}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword((v) => !v)}
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              accessibilityRole="button"
            >
              <Text style={styles.eyeButtonText}>{showPassword ? "Hide" : "Show"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.button, (loading || googleLoading) && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading || googleLoading}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: loading || googleLoading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={t.primaryForeground} />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.googleButton, (loading || googleLoading) && styles.buttonDisabled]}
          onPress={handleGoogleSignIn}
          disabled={loading || googleLoading}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: loading || googleLoading, busy: googleLoading }}
        >
          {googleLoading ? (
            <ActivityIndicator color={t.foreground} />
          ) : (
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotLink}
          onPress={() => router.push("/(auth)/forgot-password")}
          accessibilityRole="link"
          accessibilityLabel="Forgot password"
        >
          <Text style={styles.footerLink}>Forgot password?</Text>
        </TouchableOpacity>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New to Spencare? </Text>
          <TouchableOpacity
            onPress={() => router.replace("/(auth)/sign-up")}
            accessibilityRole="link"
            accessibilityLabel="Create account"
          >
            <Text style={styles.footerLink}>Create account</Text>
          </TouchableOpacity>
        </View>
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
    brand: {
      fontSize: typography.size["4xl"],
      fontWeight: typography.weight.bold,
      textAlign: "center",
      color: t.foreground,
      marginBottom: 2,
    },
    tagline: {
      fontSize: typography.size.base,
      textAlign: "center",
      color: t.foregroundMuted,
      marginBottom: spacing.lg,
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
      fontSize: typography.size.lg,
      backgroundColor: t.backgroundSubtle,
      color: t.foreground,
    },
    passwordRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    passwordInput: {
      flex: 1,
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0,
      borderRightWidth: 0,
    },
    eyeButton: {
      height: 48,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: t.border,
      borderTopRightRadius: radius.md,
      borderBottomRightRadius: radius.md,
      backgroundColor: t.backgroundSubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    eyeButtonText: {
      fontSize: typography.size.sm,
      color: t.primary,
      fontWeight: typography.weight.medium,
    },
    errorBox: {
      backgroundColor: t.destructiveSubtle,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: t.destructiveBorder,
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
    divider: { flexDirection: "row", alignItems: "center" },
    dividerLine: { flex: 1, height: 1, backgroundColor: t.border },
    dividerText: {
      marginHorizontal: spacing.md,
      fontSize: typography.size.sm,
      color: t.foregroundMuted,
    },
    googleButton: {
      height: 48,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.backgroundSubtle,
    },
    googleButtonText: {
      color: t.foreground,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
    },
    forgotLink: {
      alignItems: "center",
      paddingVertical: spacing.sm,
      marginTop: spacing.xs,
    },
    footerRow: {
      flexDirection: "row",
      justifyContent: "center",
      marginTop: spacing.md,
    },
    footerText: { fontSize: typography.size.base, color: t.foregroundMuted },
    footerLink: {
      fontSize: typography.size.base,
      color: t.primary,
      fontWeight: typography.weight.semibold,
    },
  });
}
