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
import { colors, radii, shadows, spacing, typography } from "../../src/theme/tokens";

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
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading event details...</Text>
      </View>
    );
  }

  if (error && !event) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => void fetchEventDetail(false)}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
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
          tintColor={colors.primary}
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
            <View key={session.id} style={styles.timelineCard}>
              <View style={styles.timelineAccent} />
              <View style={styles.timelineContent}>
                <View style={styles.timePill}>
                  <Text style={styles.itemTime}>
                    {formatSessionTimeRange(session.start_at, session.end_at)} ·{" "}
                    {session.room_or_stage}
                  </Text>
                </View>
                <Text style={styles.itemTitle}>{session.title}</Text>
                <Text style={styles.itemSubtitle}>
                  Speaker: {session.speaker_name}
                </Text>
              </View>
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
            <View key={post.id} style={styles.postCard}>
              <Text style={styles.itemTitle}>{post.title}</Text>
              <Text style={styles.postBody}>{post.body}</Text>
              <Text style={styles.postTime}>
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
    backgroundColor: colors.canvas,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodyMuted,
  },
  errorCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    alignItems: "center",
    gap: spacing.lg,
    ...shadows.card,
  },
  errorText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md - 2,
    borderRadius: radii.button,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.88,
  },
  offlineBanner: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.input,
    padding: spacing.md,
    gap: 2,
  },
  offlineTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.warning,
  },
  offlineSubtitle: {
    fontSize: 12,
    color: colors.inkMuted,
  },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.card,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
    textTransform: "capitalize",
  },
  title: {
    ...typography.h1,
  },
  metaText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.inkMuted,
  },
  metaSubtext: {
    ...typography.caption,
  },
  section: {
    gap: spacing.md - 2,
  },
  sectionTitle: {
    ...typography.h3,
    fontSize: 17,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.subtle,
  },
  emptyText: {
    ...typography.bodyMuted,
  },
  timelineCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    overflow: "hidden",
    ...shadows.subtle,
  },
  timelineAccent: {
    width: 4,
    backgroundColor: colors.primary,
  },
  timelineContent: {
    flex: 1,
    padding: spacing.md + 2,
    gap: spacing.xs + 2,
  },
  timePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  itemTime: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "700",
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
  },
  itemSubtitle: {
    fontSize: 13,
    color: colors.inkMuted,
    fontWeight: "500",
  },
  postCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs + 2,
    ...shadows.subtle,
  },
  postBody: {
    ...typography.body,
    fontSize: 14,
    color: colors.inkMuted,
  },
  postTime: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
});
