import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ActivityIndicator, View } from "react-native";

export default function ProtectedLayout(): React.JSX.Element {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
