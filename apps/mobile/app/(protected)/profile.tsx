import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import {
  useTheme,
  useThemePreference,
  radius,
  spacing,
  typography,
  type Theme,
  type ThemePreference,
} from "@/lib/theme";
import { api } from "@/lib/api";

export default function ProfileScreen(): React.JSX.Element {
  const { session, signOut } = useAuth();
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [privacyMode, setPrivacyModeState] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    api
      .getDashboard(session.accessToken)
      .then((d) => setPrivacyModeState(d.privacyMode))
      .catch(() => {});
  }, [session]);

  const togglePrivacyMode = useCallback(async (enabled: boolean) => {
    if (!session || privacyLoading) return;
    setPrivacyModeState(enabled);
    setPrivacyLoading(true);
    try {
      await api.updatePrivacyMode(enabled, session.accessToken);
    } catch {
      setPrivacyModeState(!enabled); // revert on error
      Alert.alert("Error", "Couldn't update privacy mode. Try again.");
    } finally {
      setPrivacyLoading(false);
    }
  }, [session, privacyLoading]);

  async function handleSignOut(): Promise<void> {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          try { await signOut(); } catch {}
        },
      },
    ]);
  }

  const THEME_OPTIONS: { label: string; value: ThemePreference }[] = [
    { label: "System", value: "system" },
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* User identity */}
      <View style={styles.identityCard}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarInitial}>
            {session?.user.email?.charAt(0).toUpperCase() ?? "U"}
          </Text>
        </View>
        <Text style={styles.email}>{session?.user.email ?? ""}</Text>
      </View>

      {/* Settings sections */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>

        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <Text style={styles.rowTitle}>Privacy Mode</Text>
            <Text style={styles.rowSubtitle}>Hide all financial amounts on screen</Text>
          </View>
          <Switch
            value={privacyMode}
            onValueChange={togglePrivacyMode}
            disabled={privacyLoading}
            trackColor={{ true: t.primary, false: t.border }}
            thumbColor={t.background}
            accessibilityLabel="Privacy Mode"
            accessibilityRole="switch"
            accessibilityState={{ checked: privacyMode, disabled: privacyLoading }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Accounts</Text>
        <TouchableOpacity
          style={styles.navRow}
          onPress={() => router.push("/settings/accounts" as never)}
          accessibilityRole="button"
          accessibilityLabel="Manage accounts"
        >
          <Text style={styles.navRowText}>Manage accounts</Text>
          <Text style={styles.navRowChevron}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.chipRow}>
          {THEME_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.chip, preference === opt.value && styles.chipSelected]}
              onPress={() => setPreference(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: preference === opt.value }}
              accessibilityLabel={`${opt.label} theme`}
            >
              <Text style={[styles.chipText, preference === opt.value && styles.chipTextSelected]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Sign out */}
      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.backgroundSubtle },
    scrollContent: { padding: spacing.lg, gap: spacing.lg },
    identityCard: {
      backgroundColor: t.background,
      borderRadius: radius.xl,
      padding: spacing.xl,
      alignItems: "center",
      gap: spacing.md,
      borderWidth: 1,
      borderColor: t.border,
    },
    avatarCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.primarySubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: {
      fontSize: typography.size["2xl"],
      fontWeight: typography.weight.bold,
      color: t.primary,
    },
    email: { fontSize: typography.size.base, color: t.foregroundMuted },
    section: {
      backgroundColor: t.background,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
      borderWidth: 1,
      borderColor: t.border,
    },
    sectionTitle: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
      color: t.foregroundMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    rowLabel: { flex: 1, marginRight: spacing.md },
    rowTitle: { fontSize: typography.size.base, fontWeight: typography.weight.medium, color: t.foreground },
    rowSubtitle: { fontSize: typography.size.sm, color: t.foregroundMuted, marginTop: 2 },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    navRowText: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium },
    navRowChevron: { fontSize: 20, color: t.foregroundMuted },
    chipRow: { flexDirection: "row", gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.backgroundSubtle,
    },
    chipSelected: { backgroundColor: t.primarySubtle, borderColor: t.primary },
    chipText: { fontSize: typography.size.sm, color: t.foregroundMuted, fontWeight: typography.weight.medium },
    chipTextSelected: { color: t.primary },
    signOutButton: {
      height: 48,
      backgroundColor: t.destructive,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.sm,
    },
    signOutText: {
      color: t.destructiveFg,
      fontSize: typography.size.base,
      fontWeight: typography.weight.semibold,
    },
  });
}
