import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth, checkOnboarding } from "@/lib/auth";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";

const PASSWORD_MIN = 8;

function passwordStrengthError(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include a number.";
  return null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function SignUpScreen(): React.JSX.Element {
  const { signUp, signInWithGoogle } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp(): Promise<void> {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) { setError("Email is required."); return; }
    if (!isValidEmail(trimmedEmail)) { setError("Enter a valid email address."); return; }

    const pwErr = passwordStrengthError(password);
    if (pwErr) { setError(pwErr); return; }

    if (password !== confirmPassword) { setError("Passwords don't match."); return; }

    setLoading(true);
    try {
      await signUp(trimmedEmail, password);
      // New users always go to onboarding first.
      router.replace("/onboarding");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      if (raw.toLowerCase().includes("already registered") || raw.includes("409")) {
        setError("An account with this email already exists. Try signing in.");
      } else if (raw.toLowerCase().includes("network") || raw.toLowerCase().includes("fetch")) {
        setError("Unable to connect. Check your network and try again.");
      } else if (raw.toLowerCase().includes("too many")) {
        setError("Too many attempts. Please wait and try again.");
      } else {
        setError("Sign-up failed. Please try again.");
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
      if (raw.toLowerCase().includes("network") || raw.toLowerCase().includes("fetch")) {
        setError("Unable to connect. Check your network and try again.");
      } else if (raw.toLowerCase().includes("too many")) {
        setError("Too many attempts. Please wait and try again.");
      } else {
        setError("Sign-in with Google failed. Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.brand}>Spencare</Text>
        <Text style={styles.tagline}>Create your account</Text>

        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View>
          <Text style={styles.label} nativeID="emailLabel">Email</Text>
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
            onChangeText={(v) => { setEmail(v); if (error) setError(null); }}
            editable={!loading}
            returnKeyType="next"
          />
        </View>

        <View>
          <Text style={styles.label} nativeID="passwordLabel">Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Min 8 chars, upper, lower, number"
              placeholderTextColor={t.foregroundSubtle}
              secureTextEntry={!showPassword}
              textContentType="newPassword"
              accessibilityLabel="Password"
              accessibilityLabelledBy="passwordLabel"
              value={password}
              onChangeText={(v) => { setPassword(v); if (error) setError(null); }}
              editable={!loading}
              returnKeyType="next"
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

        <View>
          <Text style={styles.label} nativeID="confirmLabel">Confirm Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter your password"
            placeholderTextColor={t.foregroundSubtle}
            secureTextEntry={!showPassword}
            textContentType="newPassword"
            accessibilityLabel="Confirm password"
            accessibilityLabelledBy="confirmLabel"
            value={confirmPassword}
            onChangeText={(v) => { setConfirmPassword(v); if (error) setError(null); }}
            onSubmitEditing={handleSignUp}
            editable={!loading}
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity
          style={[styles.button, (loading || googleLoading) && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading || googleLoading}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          accessibilityState={{ disabled: loading || googleLoading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={t.primaryForeground} />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
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

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() => router.replace("/(auth)/sign-in")}
            accessibilityRole="link"
            accessibilityLabel="Sign in"
          >
            <Text style={styles.footerLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxl,
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
    passwordRow: { flexDirection: "row", alignItems: "center" },
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
    errorText: { color: t.destructive, fontSize: typography.size.base },
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
