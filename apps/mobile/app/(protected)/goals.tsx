import { View, Text, StyleSheet } from "react-native";

export default function GoalsScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Goals</Text>
      <Text style={styles.sub}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" },
  text: { fontSize: 20, fontWeight: "700", color: "#1e293b" },
  sub: { fontSize: 14, color: "#94a3b8", marginTop: 4 },
});
