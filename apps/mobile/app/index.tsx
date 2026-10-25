import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ActivityIndicator, View } from "react-native";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Root index: redirect based on auth + onboarding state.
export default function Index(): React.JSX.Element {
  const { session, isLoading } = useAuth();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(true);

  useEffect(() => {
    if (!session) {
      setOnboardingChecked(true);
      return;
    }
    api
      .getOnboardingStatus(session.accessToken)
      .then((status) => setOnboardingComplete(status.completed))
      .catch(() => setOnboardingComplete(true)) // on error assume complete → go to home
      .finally(() => setOnboardingChecked(true));
  }, [session]);

  if (isLoading || (session && !onboardingChecked)) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (session) {
    if (!onboardingComplete) return <Redirect href="/onboarding" />;
    return <Redirect href="/(protected)/home" />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}
