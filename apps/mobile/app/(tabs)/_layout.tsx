import React from "react";
import { Tabs } from "expo-router";

/**
 * Bottom tab navigator for authenticated attendee workflows.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#111827",
        tabBarInactiveTintColor: "#6b7280",
        headerStyle: { backgroundColor: "#ffffff" },
        headerTitleStyle: { color: "#111827", fontWeight: "700" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "My Tickets" }} />
      <Tabs.Screen name="events" options={{ title: "Events" }} />
      <Tabs.Screen name="claim" options={{ title: "Claim" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
