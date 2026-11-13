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
        <ActivityIndicator size="large" color="#111827" />
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
            style={styles.retryButton}
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
          />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No tickets yet</Text>
              <Text style={styles.emptySubtitle}>
                Claim a ticket with your claim token to store it here for offline
                venue entry.
              </Text>
              <Pressable
                style={styles.claimButton}
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
          return (
            <Pressable
              style={styles.ticketCard}
              onPress={() => router.push(`/tickets/${item.ticket_code}`)}
              accessibilityRole="button"
            >
              <View style={styles.ticketHeader}>
                <View
                  style={[
                    styles.badge,
                    statusMeta.badgeStyle === "checkedIn"
                      ? styles.badgeCheckedIn
                      : statusMeta.badgeStyle === "cancelled"
                      ? styles.badgeCancelled
                      : styles.badgeValid,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      statusMeta.badgeStyle === "checkedIn"
                        ? styles.badgeTextCheckedIn
                        : statusMeta.badgeStyle === "cancelled"
                        ? styles.badgeTextCancelled
                        : styles.badgeTextValid,
                    ]}
                  >
                    {statusMeta.label}
                  </Text>
                </View>
                <Text style={styles.ticketCode}>{item.ticket_code}</Text>
              </View>

              <Text style={styles.attendeeName}>{item.attendee_name}</Text>
              <Text style={styles.attendeeEmail}>{item.attendee_email}</Text>
              <Text style={styles.tapHint}>Tap to view offline QR pass</Text>
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
    backgroundColor: "#f9fafb",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
  },
  offlineBanner: {
    backgroundColor: "#fffbeb",
    borderBottomWidth: 1,
    borderBottomColor: "#fde68a",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  offlineTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400e",
  },
  offlineSubtitle: {
    fontSize: 12,
    color: "#b45309",
    marginTop: 2,
  },
  errorBanner: {
    margin: 16,
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  errorText: {
    flex: 1,
    color: "#b91c1c",
    fontSize: 14,
  },
  retryButton: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 24,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 20,
  },
  claimButton: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  claimButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  ticketCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
  },
  ticketHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeValid: {
    backgroundColor: "#ecfdf5",
  },
  badgeCheckedIn: {
    backgroundColor: "#f3f4f6",
  },
  badgeCancelled: {
    backgroundColor: "#fef2f2",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  badgeTextValid: {
    color: "#047857",
  },
  badgeTextCheckedIn: {
    color: "#374151",
  },
  badgeTextCancelled: {
    color: "#b91c1c",
  },
  ticketCode: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
  },
  attendeeName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },
  attendeeEmail: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 2,
  },
  tapHint: {
    fontSize: 12,
    color: "#4f46e5",
    fontWeight: "600",
    marginTop: 12,
  },
});
