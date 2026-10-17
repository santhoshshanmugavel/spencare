import { Stack } from "expo-router";
import { AuthProvider } from "@/lib/auth";

export default function RootLayout(): React.JSX.Element {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
