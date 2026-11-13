import React from "react";
import { Tabs } from "expo-router";
import { colors } from "../../src/theme/tokens";

/**
 * Bottom tab navigator for authenticated attendee workflows.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerShadowVisible: false,
        headerTitleStyle: {
          color: colors.ink,
          fontWeight: "700",
          fontSize: 18,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "My Tickets" }} />
      <Tabs.Screen name="events" options={{ title: "Events" }} />
      <Tabs.Screen name="claim" options={{ title: "Claim" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
