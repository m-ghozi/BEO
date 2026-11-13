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
import { colors, radii, shadows, spacing, typography } from "../../src/theme/tokens";

/**
 * User profile, push notification sync, and sign-out screen.
 */
export default function ProfileScreen() {
  const { user, syncPushToken, logout } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const initials = (user?.name ?? "B")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

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
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "B"}</Text>
          </View>
          <View style={styles.profileIdentity}>
            <Text style={styles.sectionLabel}>Account</Text>
            <Text style={styles.profileSubtitle}>{user?.email ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.divider} />

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
          <View style={styles.typePill}>
            <Text style={[styles.typePillText, styles.capitalize]}>
              {user?.account_type ?? "—"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Push Notifications</Text>
        <Text style={styles.helperText}>
          Sync your device token to receive event announcements and ticket updates.
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && !syncing && styles.primaryButtonPressed,
            syncing && styles.buttonDisabled,
          ]}
          onPress={() => void handleSyncPush()}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel="Sync Push Notifications"
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Sync Push Notifications</Text>
          )}
        </Pressable>
        {syncStatus ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusText} accessibilityLiveRegion="polite">
              {syncStatus}
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.logoutButton,
          pressed && !loggingOut && styles.logoutButtonPressed,
          loggingOut && styles.buttonDisabled,
        ]}
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
    backgroundColor: colors.canvas,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.card,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.primary,
  },
  profileIdentity: {
    flex: 1,
    gap: 2,
  },
  profileSubtitle: {
    ...typography.caption,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceMuted,
  },
  sectionLabel: {
    ...typography.h3,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  label: {
    ...typography.bodyMuted,
  },
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },
  typePill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  typePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  capitalize: {
    textTransform: "capitalize",
  },
  helperText: {
    ...typography.bodyMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.subtle,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "700",
  },
  statusBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  statusText: {
    fontSize: 13,
    color: colors.inkMuted,
  },
  logoutButton: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.button,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButtonPressed: {
    opacity: 0.88,
  },
  logoutButtonText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
