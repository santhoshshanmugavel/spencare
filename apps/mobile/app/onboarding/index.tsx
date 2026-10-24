/**
 * Onboarding wizard — 3 steps:
 *   Step 1: Name + currency (required to complete)
 *   Step 2: Income frequency (optional enrichment)
 *   Step 3: Interested categories + goal types (optional enrichment)
 *
 * Each step auto-saves to the server (incremental POST). The PUT at the end
 * atomically marks onboarding as complete with the full required payload.
 * Mirrors completeOnboarding command requirements: displayName + preferredCurrency.
 */

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
import { useAuth } from "@/lib/auth";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";
import { api } from "@/lib/api";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AUD", "CAD", "JPY"];
const INCOME_FREQUENCIES = ["weekly", "biweekly", "monthly", "irregular"] as const;
const CATEGORY_OPTIONS = [
  "Dining",
  "Groceries",
  "Transport",
  "Entertainment",
  "Healthcare",
  "Shopping",
  "Travel",
  "Utilities",
];
const GOAL_TYPE_OPTIONS = [
  "Emergency Fund",
  "Vacation",
  "Home",
  "Education",
  "Retirement",
  "Car",
];

const TOTAL_STEPS = 3;

export default function OnboardingScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 fields
  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState("INR");

  // Step 2 fields
  const [incomeFrequency, setIncomeFrequency] = useState<string | null>(null);

  // Step 3 fields
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedGoalTypes, setSelectedGoalTypes] = useState<string[]>([]);

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }
  function toggleGoalType(gt: string) {
    setSelectedGoalTypes((prev) =>
      prev.includes(gt) ? prev.filter((g) => g !== gt) : [...prev, gt],
    );
  }

  async function handleNext(): Promise<void> {
    setError(null);
    if (!session) return;

    if (step === 1) {
      if (!displayName.trim()) { setError("Enter your name to continue."); return; }
      if (displayName.trim().length > 80) { setError("Name is too long."); return; }
      setLoading(true);
      try {
        await api.saveOnboardingStep(
          { displayName: displayName.trim(), preferredCurrency: currency },
          session.accessToken,
        );
        setStep(2);
      } catch {
        setError("Couldn't save. Try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (step === 2) {
      setLoading(true);
      try {
        if (incomeFrequency) {
          await api.saveOnboardingStep({ incomeFrequency }, session.accessToken);
        }
        setStep(3);
      } catch {
        setError("Couldn't save. Try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (step === 3) {
      setLoading(true);
      try {
        await api.completeOnboarding(
          {
            displayName: displayName.trim(),
            preferredCurrency: currency,
            ...(incomeFrequency ? { incomeFrequency } : {}),
            interestedCategories: selectedCategories,
            interestedGoalTypes: selectedGoalTypes,
          },
          session.accessToken,
        );
        router.replace("/(protected)/home");
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : "";
        setError(raw || "Couldn't complete setup. Try again.");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${(step / TOTAL_STEPS) * 100}%` as `${number}%` }]} />
      </View>
      <Text style={styles.progressText}>Step {step} of {TOTAL_STEPS}</Text>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {step === 1 && (
          <Step1
            t={t}
            styles={styles}
            displayName={displayName}
            setDisplayName={setDisplayName}
            currency={currency}
            setCurrency={setCurrency}
            loading={loading}
            onError={setError}
          />
        )}
        {step === 2 && (
          <Step2
            t={t}
            styles={styles}
            incomeFrequency={incomeFrequency}
            setIncomeFrequency={setIncomeFrequency}
          />
        )}
        {step === 3 && (
          <Step3
            t={t}
            styles={styles}
            selectedCategories={selectedCategories}
            toggleCategory={toggleCategory}
            selectedGoalTypes={selectedGoalTypes}
            toggleGoalType={toggleGoalType}
          />
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={step < TOTAL_STEPS ? "Continue" : "Finish setup"}
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={t.primaryForeground} />
          ) : (
            <Text style={styles.buttonText}>
              {step < TOTAL_STEPS ? "Continue" : "Finish setup"}
            </Text>
          )}
        </TouchableOpacity>

        {step === 2 || step === 3 ? (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={() => {
              if (step === 2) { setStep(3); }
              else {
                setLoading(true);
                api
                  .completeOnboarding(
                    {
                      displayName: displayName.trim(),
                      preferredCurrency: currency,
                      interestedCategories: selectedCategories,
                      interestedGoalTypes: selectedGoalTypes,
                    },
                    session?.accessToken ?? "",
                  )
                  .then(() => router.replace("/(protected)/home"))
                  .catch(() => setError("Couldn't complete setup. Try again."))
                  .finally(() => setLoading(false));
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Skip this step"
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Step sub-components ────────────────────────────────────────────────────────

interface Step1Props {
  t: Theme;
  styles: ReturnType<typeof makeStyles>;
  displayName: string;
  setDisplayName: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  loading: boolean;
  onError: (e: string | null) => void;
}

function Step1({ t, styles, displayName, setDisplayName, currency, setCurrency, loading, onError }: Step1Props) {
  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Let's get you set up</Text>
      <Text style={styles.stepSubtitle}>What should we call you?</Text>

      <View>
        <Text style={styles.label} nativeID="nameLabel">Your name</Text>
        <TextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={t.foregroundSubtle}
          textContentType="name"
          accessibilityLabel="Your name"
          accessibilityLabelledBy="nameLabel"
          value={displayName}
          onChangeText={(v) => { setDisplayName(v); onError(null); }}
          editable={!loading}
          returnKeyType="next"
        />
      </View>

      <View>
        <Text style={styles.label}>Primary currency</Text>
        <View style={styles.chipRow}>
          {CURRENCIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, currency === c && styles.chipSelected]}
              onPress={() => setCurrency(c)}
              accessibilityRole="radio"
              accessibilityState={{ selected: currency === c }}
              accessibilityLabel={c}
            >
              <Text style={[styles.chipText, currency === c && styles.chipTextSelected]}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

interface Step2Props {
  t: Theme;
  styles: ReturnType<typeof makeStyles>;
  incomeFrequency: string | null;
  setIncomeFrequency: (v: string) => void;
}

function Step2({ t, styles, incomeFrequency, setIncomeFrequency }: Step2Props) {
  const labels: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
    irregular: "Irregular",
  };
  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Your income pattern</Text>
      <Text style={styles.stepSubtitle}>How often do you get paid? (optional)</Text>
      <View style={styles.chipRow}>
        {INCOME_FREQUENCIES.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, incomeFrequency === f && styles.chipSelected]}
            onPress={() => setIncomeFrequency(f)}
            accessibilityRole="radio"
            accessibilityState={{ selected: incomeFrequency === f }}
            accessibilityLabel={labels[f]}
          >
            <Text style={[styles.chipText, incomeFrequency === f && styles.chipTextSelected]}>
              {labels[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

interface Step3Props {
  t: Theme;
  styles: ReturnType<typeof makeStyles>;
  selectedCategories: string[];
  toggleCategory: (c: string) => void;
  selectedGoalTypes: string[];
  toggleGoalType: (g: string) => void;
}

function Step3({ t, styles, selectedCategories, toggleCategory, selectedGoalTypes, toggleGoalType }: Step3Props) {
  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Personalise Spencare</Text>
      <Text style={styles.stepSubtitle}>Tell us what matters most (optional)</Text>

      <Text style={styles.sectionLabel}>Spending categories</Text>
      <View style={styles.chipRow}>
        {CATEGORY_OPTIONS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, selectedCategories.includes(c) && styles.chipSelected]}
            onPress={() => toggleCategory(c)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selectedCategories.includes(c) }}
            accessibilityLabel={c}
          >
            <Text style={[styles.chipText, selectedCategories.includes(c) && styles.chipTextSelected]}>
              {c}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Savings goals</Text>
      <View style={styles.chipRow}>
        {GOAL_TYPE_OPTIONS.map((g) => (
          <TouchableOpacity
            key={g}
            style={[styles.chip, selectedGoalTypes.includes(g) && styles.chipSelected]}
            onPress={() => toggleGoalType(g)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selectedGoalTypes.includes(g) }}
            accessibilityLabel={g}
          >
            <Text style={[styles.chipText, selectedGoalTypes.includes(g) && styles.chipTextSelected]}>
              {g}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    progressContainer: {
      height: 3,
      backgroundColor: t.border,
      marginTop: 0,
    },
    progressBar: {
      height: 3,
      backgroundColor: t.primary,
    },
    progressText: {
      fontSize: typography.size.sm,
      color: t.foregroundMuted,
      textAlign: "center",
      paddingTop: spacing.md,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      gap: spacing.lg,
    },
    stepContent: { gap: spacing.md },
    stepTitle: {
      fontSize: typography.size["2xl"],
      fontWeight: typography.weight.bold,
      color: t.foreground,
    },
    stepSubtitle: {
      fontSize: typography.size.base,
      color: t.foregroundMuted,
      marginTop: -spacing.xs,
    },
    sectionLabel: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
      color: t.foreground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
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
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.backgroundSubtle,
    },
    chipSelected: {
      backgroundColor: t.primarySubtle,
      borderColor: t.primary,
    },
    chipText: {
      fontSize: typography.size.sm,
      color: t.foregroundMuted,
      fontWeight: typography.weight.medium,
    },
    chipTextSelected: { color: t.primary },
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
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      color: t.primaryForeground,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
    },
    skipButton: { alignItems: "center", paddingVertical: spacing.sm },
    skipText: { color: t.foregroundMuted, fontSize: typography.size.base },
  });
}
