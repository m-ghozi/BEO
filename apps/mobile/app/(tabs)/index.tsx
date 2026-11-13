import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { TicketDTO } from "@beo/contracts";
import { useAuth } from "../../src/context/AuthContext";
import { apiFetch, ApiError } from "../../src/services/api";
import {
  loadTicketsCache,
  saveTicketsCache,
} from "../../src/services/offlineCache";
import { getTicketStatusMeta } from "../../src/features/tickets/ticketStatus";
import {
  colors,
  radii,
  shadows,
  spacing,
  statusBadgeVariants,
  typography,
} from "../../src/theme/tokens";

/**
 * Offline-capable ticket wallet listing the attendee's claimed tickets.
 */
export default function MyTicketsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineUpdatedAt, setOfflineUpdatedAt] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const data = await apiFetch<TicketDTO[]>("/v1/me/tickets");
        const nextTickets = Array.isArray(data) ? data : [];
        setTickets(nextTickets);
        setIsOffline(false);
        setOfflineUpdatedAt(null);
        if (user?.id) {
          await saveTicketsCache(user.id, nextTickets);
        }
      } catch (err) {
        if (user?.id) {
          const cached = await loadTicketsCache(user.id);
          if (cached) {
            setTickets(cached.tickets);
            setIsOffline(true);
            setOfflineUpdatedAt(cached.updatedAt);
            return;
          }
        }
        setIsOffline(false);
        setOfflineUpdatedAt(null);
        if (err instanceof ApiError || err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load tickets.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    void fetchTickets(false);
  }, [fetchTickets]);

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading your tickets...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isOffline ? (
        <View style={styles.offlineBanner} accessibilityRole="alert">
          <Text style={styles.offlineTitle}>Offline Mode</Text>
          <Text style={styles.offlineSubtitle}>
            {offlineUpdatedAt
              ? `Showing cached tickets from ${new Date(offlineUpdatedAt).toLocaleString()}`
              : "Showing cached tickets"}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => void fetchTickets(false)}
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={tickets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          tickets.length === 0 ? styles.emptyListContent : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void fetchTickets(true)}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyBadge}>
                <Text style={styles.emptyBadgeText}>WALLET</Text>
              </View>
              <Text style={styles.emptyTitle}>No tickets yet</Text>
              <Text style={styles.emptySubtitle}>
                Claim a ticket with your claim token to store it here for offline
                venue entry.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.claimButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => router.push("/(tabs)/claim")}
                accessibilityRole="button"
              >
                <Text style={styles.claimButtonText}>Claim a Ticket</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const statusMeta = getTicketStatusMeta(item);
          const badgePalette = statusBadgeVariants[statusMeta.badgeStyle];

          return (
            <Pressable
              style={({ pressed }) => [
                styles.ticketCard,
                pressed && styles.ticketCardPressed,
              ]}
              onPress={() => router.push(`/tickets/${item.ticket_code}`)}
              accessibilityRole="button"
            >
              <View style={styles.ticketAccentBar} />
              <View style={styles.ticketBody}>
                <View style={styles.ticketHeader}>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: badgePalette.bg,
                        borderColor: badgePalette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.badgeText, { color: badgePalette.text }]}
                    >
                      {statusMeta.label}
                    </Text>
                  </View>
                  <View style={styles.codePill}>
                    <Text style={styles.ticketCode}>{item.ticket_code}</Text>
                  </View>
                </View>

                <Text style={styles.attendeeName}>{item.attendee_name}</Text>
                <Text style={styles.attendeeEmail}>{item.attendee_email}</Text>

                <View style={styles.ticketFooter}>
                  <Text style={styles.tapHint}>Tap to view offline QR pass</Text>
                  <Text style={styles.tapArrow}>→</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    ...typography.bodyMuted,
  },
  offlineBanner: {
    backgroundColor: colors.warningSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.warningBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  offlineTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.warning,
  },
  offlineSubtitle: {
    fontSize: 12,
    color: colors.inkMuted,
    marginTop: 2,
  },
  errorBanner: {
    margin: spacing.lg,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.88,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    alignItems: "center",
    ...shadows.card,
  },
  emptyBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    marginBottom: spacing.md,
  },
  emptyBadgeText: {
    ...typography.eyebrow,
    color: colors.primary,
  },
  emptyTitle: {
    ...typography.h2,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.bodyMuted,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  claimButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
    ...shadows.subtle,
  },
  claimButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "700",
  },
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    overflow: "hidden",
    ...shadows.card,
  },
  ticketCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  ticketAccentBar: {
    width: 4,
    backgroundColor: colors.primary,
  },
  ticketBody: {
    flex: 1,
    padding: spacing.lg,
  },
  ticketHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  badge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  codePill: {
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  ticketCode: {
    ...typography.mono,
    fontSize: 12,
    color: colors.inkMuted,
  },
  attendeeName: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
  },
  attendeeEmail: {
    ...typography.bodyMuted,
    fontSize: 13,
    marginTop: 2,
  },
  ticketFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  tapHint: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "700",
  },
  tapArrow: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "700",
  },
});
