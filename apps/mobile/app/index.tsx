import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ActivityIndicator, View } from "react-native";

// Root index: redirect based on auth state.
export default function Index(): React.JSX.Element {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(protected)/home" />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}
