import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
import { api, type ProfileJSON } from "@/lib/api";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD", "JPY"];

export default function ProfileScreen(): React.JSX.Element {
  const { session, signOut } = useAuth();
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [profile, setProfile] = useState<ProfileJSON | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [privacyLoading, setPrivacyLoading] = useState(false);

  // Edit name modal
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  // Currency picker modal
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySaving, setCurrencySaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    setProfileLoading(true);
    api
      .getProfile(session.accessToken)
      .then((res) => setProfile(res.profile))
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [session]);

  const togglePrivacyMode = useCallback(
    async (enabled: boolean) => {
      if (!session || privacyLoading) return;
      setProfile((p) => (p ? { ...p, privacy_mode_enabled: enabled } : p));
      setPrivacyLoading(true);
      try {
        await api.updatePrivacyMode(enabled, session.accessToken);
      } catch {
        setProfile((p) => (p ? { ...p, privacy_mode_enabled: !enabled } : p));
        Alert.alert("Error", "Couldn't update privacy mode. Try again.");
      } finally {
        setPrivacyLoading(false);
      }
    },
    [session, privacyLoading],
  );

  const openEditName = useCallback(() => {
    setNameInput(profile?.display_name ?? "");
    setEditNameOpen(true);
  }, [profile]);

  const saveName = useCallback(async () => {
    if (!session || nameSaving) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      Alert.alert("Error", "Name cannot be empty.");
      return;
    }
    setNameSaving(true);
    try {
      const res = await api.updateProfile({ displayName: trimmed }, session.accessToken);
      setProfile(res.profile);
      setEditNameOpen(false);
    } catch {
      Alert.alert("Error", "Couldn't save name. Try again.");
    } finally {
      setNameSaving(false);
    }
  }, [session, nameInput, nameSaving]);

  const saveCurrency = useCallback(
    async (currency: string) => {
      if (!session || currencySaving) return;
      setCurrencySaving(true);
      try {
        const res = await api.updateProfile({ preferredCurrency: currency }, session.accessToken);
        setProfile(res.profile);
        setCurrencyOpen(false);
      } catch {
        Alert.alert("Error", "Couldn't update currency. Try again.");
      } finally {
        setCurrencySaving(false);
      }
    },
    [session, currencySaving],
  );

  async function handleSignOut(): Promise<void> {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
          } catch {}
        },
      },
    ]);
  }

  const THEME_OPTIONS: { label: string; value: ThemePreference }[] = [
    { label: "System", value: "system" },
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
  ];

  const displayName = profile?.display_name;
  const email = session?.user.email ?? "";
  const initial = (displayName || email).charAt(0).toUpperCase();

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity card */}
        <View style={styles.identityCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          {profileLoading ? (
            <ActivityIndicator size="small" color={t.primary} />
          ) : (
            <>
              <Text style={styles.displayName}>{displayName ?? email}</Text>
              {displayName ? <Text style={styles.email}>{email}</Text> : null}
            </>
          )}
          <TouchableOpacity
            style={styles.editNameBtn}
            onPress={openEditName}
            accessibilityRole="button"
            accessibilityLabel="Edit display name"
          >
            <Text style={styles.editNameBtnText}>Edit name</Text>
          </TouchableOpacity>
        </View>

        {/* Account settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity
            style={styles.navRow}
            onPress={() => setCurrencyOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Change currency"
          >
            <Text style={styles.navRowText}>Currency</Text>
            <View style={styles.navRowRight}>
              <Text style={styles.navRowValue}>{profile?.preferred_currency ?? "INR"}</Text>
              <Text style={styles.navRowChevron}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Privacy */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>

          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Text style={styles.rowTitle}>Privacy Mode</Text>
              <Text style={styles.rowSubtitle}>Hide all financial amounts</Text>
            </View>
            <Switch
              value={profile?.privacy_mode_enabled ?? false}
              onValueChange={togglePrivacyMode}
              disabled={privacyLoading || profileLoading}
              trackColor={{ true: t.primary, false: t.border }}
              thumbColor={t.background}
              accessibilityLabel="Privacy Mode"
              accessibilityRole="switch"
              accessibilityState={{
                checked: profile?.privacy_mode_enabled ?? false,
                disabled: privacyLoading,
              }}
            />
          </View>
        </View>

        {/* Data */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data</Text>

          <TouchableOpacity
            style={styles.navRow}
            onPress={() => router.push("/settings/accounts" as never)}
            accessibilityRole="button"
            accessibilityLabel="Manage accounts"
          >
            <Text style={styles.navRowText}>Manage accounts</Text>
            <Text style={styles.navRowChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity
            style={styles.navRow}
            onPress={() => router.push("/settings/categories" as never)}
            accessibilityRole="button"
            accessibilityLabel="Manage categories"
          >
            <Text style={styles.navRowText}>Categories</Text>
            <Text style={styles.navRowChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Appearance */}
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
                <Text
                  style={[styles.chipText, preference === opt.value && styles.chipTextSelected]}
                >
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

      {/* Edit Name Modal */}
      <Modal
        visible={editNameOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditNameOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit display name</Text>
            <TextInput
              style={styles.textInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Your name"
              placeholderTextColor={t.foregroundMuted}
              autoFocus
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setEditNameOpen(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary, nameSaving && styles.btnDisabled]}
                onPress={saveName}
                disabled={nameSaving}
              >
                {nameSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Currency Picker Modal */}
      <Modal
        visible={currencyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCurrencyOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select currency</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.currencyRow,
                    profile?.preferred_currency === c && styles.currencyRowSelected,
                  ]}
                  onPress={() => saveCurrency(c)}
                  disabled={currencySaving}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: profile?.preferred_currency === c }}
                  accessibilityLabel={c}
                >
                  <Text
                    style={[
                      styles.currencyText,
                      profile?.preferred_currency === c && styles.currencyTextSelected,
                    ]}
                  >
                    {c}
                  </Text>
                  {profile?.preferred_currency === c && (
                    <Text style={styles.currencyCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel, { marginTop: spacing.md }]}
              onPress={() => setCurrencyOpen(false)}
            >
              <Text style={styles.modalBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.backgroundSubtle },
    scrollContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    identityCard: {
      backgroundColor: t.background,
      borderRadius: radius.xl,
      padding: spacing.xl,
      alignItems: "center",
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: t.border,
    },
    avatarCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.primarySubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: {
      fontSize: typography.size["3xl"],
      fontWeight: typography.weight.bold,
      color: t.primary,
    },
    displayName: {
      fontSize: typography.size.xl,
      fontWeight: typography.weight.semibold,
      color: t.foreground,
    },
    email: { fontSize: typography.size.sm, color: t.foregroundMuted },
    editNameBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.primary,
      marginTop: spacing.xs,
    },
    editNameBtnText: { fontSize: typography.size.sm, color: t.primary, fontWeight: typography.weight.medium },
    section: {
      backgroundColor: t.background,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
      borderWidth: 1,
      borderColor: t.border,
    },
    sectionTitle: {
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
      color: t.foregroundMuted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    separator: { height: 1, backgroundColor: t.separator },
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
      paddingVertical: 2,
    },
    navRowText: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium },
    navRowRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    navRowValue: { fontSize: typography.size.base, color: t.foregroundMuted },
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
      height: 50,
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
    // Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalSheet: {
      backgroundColor: t.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    modalTitle: {
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
      color: t.foreground,
      marginBottom: spacing.sm,
    },
    textInput: {
      height: 48,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: typography.size.base,
      color: t.foreground,
      backgroundColor: t.backgroundSubtle,
    },
    modalActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
    modalBtn: { flex: 1, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    modalBtnCancel: { borderWidth: 1, borderColor: t.border, backgroundColor: t.backgroundSubtle },
    modalBtnCancelText: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium },
    modalBtnPrimary: { backgroundColor: t.primary },
    modalBtnPrimaryText: { fontSize: typography.size.base, color: "#fff", fontWeight: typography.weight.semibold },
    btnDisabled: { opacity: 0.5 },
    currencyRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    currencyRowSelected: { backgroundColor: t.primarySubtle },
    currencyText: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium },
    currencyTextSelected: { color: t.primary, fontWeight: typography.weight.semibold },
    currencyCheck: { fontSize: typography.size.md, color: t.primary, fontWeight: typography.weight.bold },
  });
}
