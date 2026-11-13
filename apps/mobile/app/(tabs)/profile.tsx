import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../../src/context/AuthContext";

/**
 * User profile, push notification sync, and sign-out screen.
 */
export default function ProfileScreen() {
  const { user, syncPushToken, logout } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleSyncPush = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const pushToken = await syncPushToken();
      if (pushToken) {
        setSyncStatus("Push notifications synced.");
      } else {
        setSyncStatus(
          "Push notifications unavailable (permission denied or simulator)."
        );
      }
    } catch {
      setSyncStatus("Failed to sync push notifications.");
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user?.name ?? "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email ?? "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Account Type</Text>
          <Text style={[styles.value, styles.capitalize]}>
            {user?.account_type ?? "—"}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Push Notifications</Text>
        <Text style={styles.helperText}>
          Sync your device token to receive event announcements and ticket updates.
        </Text>
        <Pressable
          style={[styles.primaryButton, syncing && styles.buttonDisabled]}
          onPress={() => void handleSyncPush()}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel="Sync Push Notifications"
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Sync Push Notifications</Text>
          )}
        </Pressable>
        {syncStatus ? (
          <Text style={styles.statusText} accessibilityLiveRegion="polite">
            {syncStatus}
          </Text>
        ) : null}
      </View>

      <Pressable
        style={[styles.logoutButton, loggingOut && styles.buttonDisabled]}
        onPress={() => void handleLogout()}
        disabled={loggingOut}
        accessibilityRole="button"
        accessibilityLabel="Sign Out"
      >
        <Text style={styles.logoutButtonText}>
          {loggingOut ? "Signing Out..." : "Sign Out"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    gap: 12,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  label: {
    fontSize: 14,
    color: "#6b7280",
  },
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    flexShrink: 1,
    textAlign: "right",
  },
  capitalize: {
    textTransform: "capitalize",
  },
  helperText: {
    fontSize: 13,
    color: "#4b5563",
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  statusText: {
    fontSize: 13,
    color: "#374151",
  },
  logoutButton: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButtonText: {
    color: "#b91c1c",
    fontSize: 15,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
