import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useTheme, typography } from "@/lib/theme";
import { ActivityIndicator, Text, View } from "react-native";

function TabIcon({ symbol, color }: { symbol: string; color: string }): React.JSX.Element {
  return <Text style={{ fontSize: 22, color }}>{symbol}</Text>;
}

export default function ProtectedLayout(): React.JSX.Element {
  const { session, isLoading } = useAuth();
  const t = useTheme();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.background }}>
        <ActivityIndicator color={t.primary} />
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
        tabBarActiveTintColor: t.tabBarActive,
        tabBarInactiveTintColor: t.tabBarInactive,
        tabBarStyle: {
          backgroundColor: t.tabBarBackground,
          borderTopColor: t.tabBarBorder,
          height: 60,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: typography.size.xs,
          fontWeight: typography.weight.medium,
        },
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
        name="budgets"
        options={{
          title: "Budgets",
          tabBarIcon: ({ color }) => <TabIcon symbol="◈" color={color} />,
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          title: "Upcoming",
          tabBarIcon: ({ color }) => <TabIcon symbol="📅" color={color} />,
        }}
      />
      <Tabs.Screen
        name="spensa"
        options={{
          title: "Spensa",
          tabBarIcon: ({ color }) => <TabIcon symbol="✦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings/accounts"
        options={{ href: null }}
      />
    </Tabs>
  );
}
