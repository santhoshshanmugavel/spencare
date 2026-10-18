import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ActivityIndicator, Text, View } from "react-native";

function TabIcon({ symbol, color }: { symbol: string; color: string }): React.JSX.Element {
  return <Text style={{ fontSize: 22, color }}>{symbol}</Text>;
}

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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e2e8f0",
          height: 60,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: "Transactions",
          tabBarIcon: ({ color }) => <TabIcon symbol="↔" color={color} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: ({ color }) => <TabIcon symbol="⚑" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} />,
        }}
      />
    </Tabs>
  );
}
