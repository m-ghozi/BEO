import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as Notifications from "expo-notifications";
import { Slot, useRouter, useSegments } from "expo-router";
import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { resolveNotificationRoute } from "../src/services/notificationRouting";

function AuthGuard() {
  const { token, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    if (!token && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (token && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [isLoading, token, segments, router]);

  useEffect(() => {
    if (isLoading || !token) return;

    let active = true;
    const handleResponse = (
      response: Notifications.NotificationResponse | null | undefined
    ) => {
      if (!response) return;
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const route = resolveNotificationRoute(data);
      if (route) {
        router.push(route as never);
      }
    };

    if (typeof Notifications.getLastNotificationResponseAsync === "function") {
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (active) {
          handleResponse(response);
        }
      });
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleResponse(response);
      }
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, [isLoading, token, router]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  return <Slot />;
}

/**
 * Root layout wrapping the application with authentication state and route protection.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGuard />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
});

