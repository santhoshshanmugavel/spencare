import { Stack } from "expo-router";
import { AuthProvider } from "@/lib/auth";
import { ThemePreferenceProvider } from "@/lib/theme";

export default function RootLayout(): React.JSX.Element {
  return (
    <ThemePreferenceProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </ThemePreferenceProvider>
  );
}
