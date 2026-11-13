import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { EventDTO } from "@beo/contracts";
import { apiFetch, ApiError } from "../../src/services/api";

function formatDateRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startAt} - ${endAt}`;
  }
  return `${start.toLocaleDateString()} · ${start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * Directory of published events with search filtering and pull-to-refresh.
 */
export default function EventsDirectoryScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await apiFetch<EventDTO[]>("/v1/events");
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err instanceof ApiError || err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load events.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents(false);
  }, [fetchEvents]);

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return events;
    }
    return events.filter(
      (event) =>
        event.title.toLowerCase().includes(normalized) ||
        event.venue.toLowerCase().includes(normalized)
    );
  }, [events, query]);

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#111827" />
        <Text style={styles.loadingText}>Loading events...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by title or venue..."
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search events"
        />
      </View>

      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => void fetchEvents(false)}
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={filteredEvents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          filteredEvents.length === 0 ? styles.emptyListContent : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void fetchEvents(true)}
            tintColor="#111827"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() =>
              router.push(`/events/${encodeURIComponent(item.slug)}` as never)
            }
            accessibilityRole="button"
            accessibilityLabel={`View event ${item.title}`}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{item.event_type}</Text>
              </View>
            </View>
            <Text style={styles.cardVenue}>{item.venue}</Text>
            <Text style={styles.cardDate}>
              {formatDateRange(item.start_at, item.end_at)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No events found</Text>
            <Text style={styles.emptySubtitle}>
              {query.trim()
                ? "Try adjusting your search query."
                : "Published events will appear here."}
            </Text>
          </View>
        }
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
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#4b5563",
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  searchInput: {
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
  },
  errorBanner: {
    backgroundColor: "#fef2f2",
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  errorText: {
    flex: 1,
    color: "#991b1b",
    fontSize: 14,
  },
  retryButton: {
    backgroundColor: "#991b1b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
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
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    gap: 6,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  typeBadge: {
    backgroundColor: "#eef2ff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#3730a3",
    textTransform: "capitalize",
  },
  cardVenue: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  cardDate: {
    fontSize: 13,
    color: "#6b7280",
  },
  emptyContainer: {
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
});
