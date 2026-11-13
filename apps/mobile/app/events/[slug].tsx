import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { EventDTO, SessionDTO } from "@beo/contracts";
import { apiFetch, ApiError } from "../../src/services/api";
import {
  loadEventDetailCache,
  saveEventDetailCache,
  type EventPostDTO,
} from "../../src/services/offlineCache";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function formatSessionTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startAt} - ${endAt}`;
  }
  return `${start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * Offline-capable event detail view displaying metadata, schedule sessions,
 * and organizer announcements.
 */
export default function EventDetailScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;

  const [event, setEvent] = useState<EventDTO | null>(null);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [posts, setPosts] = useState<EventPostDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [offlineUpdatedAt, setOfflineUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchEventDetail = useCallback(
    async (isRefresh = false) => {
      if (!slug) {
        setError("Missing event slug.");
        setLoading(false);
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const fetchedEvent = await apiFetch<EventDTO>(
          `/v1/events/${encodeURIComponent(slug)}`
        );
        const [fetchedSessions, fetchedPosts] = await Promise.all([
          apiFetch<SessionDTO[]>(
            `/v1/events/${encodeURIComponent(fetchedEvent.id)}/sessions`
          ),
          apiFetch<EventPostDTO[]>(
            `/v1/events/${encodeURIComponent(fetchedEvent.id)}/posts`
          ),
        ]);

        const nextSessions = Array.isArray(fetchedSessions) ? fetchedSessions : [];
        const nextPosts = Array.isArray(fetchedPosts) ? fetchedPosts : [];

        setEvent(fetchedEvent);
        setSessions(nextSessions);
        setPosts(nextPosts);
        setIsOffline(false);
        setOfflineUpdatedAt(null);

        await saveEventDetailCache(slug, {
          event: fetchedEvent,
          sessions: nextSessions,
          posts: nextPosts,
        });
      } catch (err) {
        const cached = await loadEventDetailCache(slug);
        if (cached) {
          setEvent(cached.event);
          setSessions(cached.sessions);
          setPosts(cached.posts);
          setIsOffline(true);
          setOfflineUpdatedAt(cached.updatedAt);
          return;
        }

        setIsOffline(false);
        setOfflineUpdatedAt(null);
        if (err instanceof ApiError || err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load event details.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    void fetchEventDetail(false);
  }, [fetchEventDetail]);

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#111827" />
        <Text style={styles.loadingText}>Loading event details...</Text>
      </View>
    );
  }

  if (error && !event) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => void fetchEventDetail(false)}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void fetchEventDetail(true)}
          tintColor="#111827"
        />
      }
    >
      {isOffline ? (
        <View style={styles.offlineBanner} accessibilityRole="alert">
          <Text style={styles.offlineTitle}>Offline Mode</Text>
          <Text style={styles.offlineSubtitle}>
            {offlineUpdatedAt
              ? `Showing cached event details from ${formatDateTime(offlineUpdatedAt)}`
              : "Showing cached event details"}
          </Text>
        </View>
      ) : null}

      {event ? (
        <View style={styles.headerCard}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{event.event_type}</Text>
          </View>
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.metaText}>{event.venue}</Text>
          <Text style={styles.metaSubtext}>
            {formatDateTime(event.start_at)} — {formatDateTime(event.end_at)}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Schedule / Sessions</Text>
        {sessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No sessions scheduled yet.</Text>
          </View>
        ) : (
          sessions.map((session) => (
            <View key={session.id} style={styles.itemCard}>
              <Text style={styles.itemTime}>
                {formatSessionTimeRange(session.start_at, session.end_at)} ·{" "}
                {session.room_or_stage}
              </Text>
              <Text style={styles.itemTitle}>{session.title}</Text>
              <Text style={styles.itemSubtitle}>Speaker: {session.speaker_name}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Announcements / Posts</Text>
        {posts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No announcements yet.</Text>
          </View>
        ) : (
          posts.map((post) => (
            <View key={post.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{post.title}</Text>
              <Text style={styles.postBody}>{post.body}</Text>
              <Text style={styles.itemTime}>
                {formatDateTime(post.published_at)}
              </Text>
            </View>
          ))
        )}
      </View>
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
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    padding: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: "#4b5563",
  },
  errorText: {
    color: "#991b1b",
    fontSize: 15,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#111827",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  offlineBanner: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  offlineTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400e",
  },
  offlineSubtitle: {
    fontSize: 12,
    color: "#78350f",
  },
  headerCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    gap: 6,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#eef2ff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#3730a3",
    textTransform: "capitalize",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
  },
  metaText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#374151",
  },
  metaSubtext: {
    fontSize: 13,
    color: "#6b7280",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  emptyText: {
    fontSize: 14,
    color: "#6b7280",
  },
  itemCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    gap: 4,
  },
  itemTime: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  itemSubtitle: {
    fontSize: 13,
    color: "#374151",
  },
  postBody: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
});
