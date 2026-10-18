import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "@/lib/auth";

export default function ProfileScreen(): React.JSX.Element {
  const { session, signOut } = useAuth();

  async function handleSignOut(): Promise<void> {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
          } catch {
            // State is cleared locally regardless.
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.email}>{session?.user.email ?? "User"}</Text>
      <TouchableOpacity style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 24,
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
  email: { fontSize: 14, color: "#64748b" },
  button: {
    height: 44,
    paddingHorizontal: 32,
    backgroundColor: "#ef4444",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
