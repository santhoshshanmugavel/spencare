import { useCallback, useMemo, useState } from "react";
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
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";
import { api } from "@/lib/api";

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  showValue,
  onToggleShow,
  t,
  styles,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  showValue: boolean;
  onToggleShow: () => void;
  t: Theme;
  styles: ReturnType<typeof makeStyles>;
}): React.JSX.Element {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputFlex]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.foregroundSubtle}
          secureTextEntry={!showValue}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          accessibilityLabel={label}
        />
        <TouchableOpacity
          onPress={onToggleShow}
          accessibilityRole="button"
          accessibilityLabel={showValue ? `Hide ${label}` : `Show ${label}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.toggleText}>{showValue ? "Hide" : "Show"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChangePasswordScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async () => {
    if (!session) return;

    // Client-side validation — mirrors the server's constraints.
    if (!current) {
      Alert.alert("Error", "Enter your current password.");
      return;
    }
    if (next.length < 8) {
      Alert.alert("Error", "New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }
    if (next === current) {
      Alert.alert("Error", "New password must be different from the current one.");
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(current, next, session.accessToken);
      Alert.alert("Password changed", "Your password has been updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to change password.");
    } finally {
      setLoading(false);
    }
  }, [session, current, next, confirm]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Change Password</Text>
      <Text style={styles.hint}>
        Enter your current password to confirm your identity, then choose a new one.
      </Text>

      <Field
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        placeholder="Current password"
        showValue={showCurrent}
        onToggleShow={() => setShowCurrent((v) => !v)}
        t={t}
        styles={styles}
      />

      <View style={styles.divider} />

      <Field
        label="New password"
        value={next}
        onChangeText={setNext}
        placeholder="At least 8 characters"
        showValue={showNext}
        onToggleShow={() => setShowNext((v) => !v)}
        t={t}
        styles={styles}
      />

      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Repeat new password"
        showValue={showConfirm}
        onToggleShow={() => setShowConfirm((v) => !v)}
        t={t}
        styles={styles}
      />

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={() => void submit()}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Save new password"
        accessibilityState={{ disabled: loading }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={t.primaryForeground} />
        ) : (
          <Text style={styles.btnText}>Save new password</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: t.backgroundSubtle },
    content: { padding: spacing.lg, paddingTop: spacing.xl },
    heading: {
      fontSize: typography.size["2xl"],
      fontWeight: typography.weight.bold,
      color: t.foreground,
      marginBottom: spacing.sm,
    },
    hint: {
      fontSize: typography.size.sm,
      color: t.foregroundSubtle,
      marginBottom: spacing.xl,
      lineHeight: 20,
    },
    fieldWrap: { marginBottom: spacing.md },
    label: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
      color: t.foreground,
      marginBottom: spacing.xs,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.background,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
    inputFlex: { flex: 1, borderWidth: 0, backgroundColor: "transparent" },
    input: {
      height: 48,
      fontSize: typography.size.base,
      color: t.foreground,
    },
    toggleText: {
      fontSize: typography.size.sm,
      color: t.primary,
      paddingLeft: spacing.sm,
    },
    divider: { height: 1, backgroundColor: t.separator, marginVertical: spacing.sm },
    btn: {
      marginTop: spacing.xl,
      height: 48,
      backgroundColor: t.primary,
      borderRadius: radius.md,
      justifyContent: "center",
      alignItems: "center",
    },
    btnDisabled: { opacity: 0.6 },
    btnText: {
      fontSize: typography.size.base,
      fontWeight: typography.weight.semibold,
      color: t.primaryForeground,
    },
  });
}
