import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import type { TicketDTO } from "@beo/contracts";
import { useAuth } from "../../src/context/AuthContext";
import { apiFetch } from "../../src/services/api";
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
 * Offline-first QR ticket pass screen loaded directly from local cache.
 */
export default function TicketQRScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [ticket, setTicket] = useState<TicketDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!user?.id || !code) {
          if (active) setTicket(null);
          return;
        }
        const cached = await loadTicketsCache(user.id);
        let match =
          cached?.tickets.find((item) => item.ticket_code === code) ?? null;

        if (!match) {
          try {
            const data = await apiFetch<TicketDTO[]>("/v1/me/tickets");
            const freshTickets = Array.isArray(data) ? data : [];
            await saveTicketsCache(user.id, freshTickets);
            match =
              freshTickets.find((item) => item.ticket_code === code) ?? null;
          } catch {
            // Keep null so offline not-found fallback renders gracefully
          }
        }

        if (active) {
          setTicket(match);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id, code]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <View style={styles.cardPadding}>
            <Text style={styles.title}>Ticket not found</Text>
            <Text style={styles.subtitle}>
              This ticket is not in your offline cache yet. Return to My Tickets
              and pull to refresh while online.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => router.back()}
              accessibilityRole="button"
            >
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const statusMeta = getTicketStatusMeta(ticket);
  const badgePalette = statusBadgeVariants[statusMeta.badgeStyle];
  const canShowQR =
    ticket.status !== "pending" && Boolean(ticket.qr_signature);

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.container}
    >
      <View style={styles.card}>
        <View style={styles.passHeader}>
          <View>
            <Text style={styles.passEyebrow}>EVENT PASS</Text>
            <Text style={styles.ticketCode}>{ticket.ticket_code}</Text>
          </View>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: badgePalette.bg,
                borderColor: badgePalette.border,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: badgePalette.text }]}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        <View style={styles.qrSection}>
          {canShowQR ? (
            <View style={styles.qrFrame}>
              <QRCode
                value={ticket.qr_signature}
                size={210}
                testID="ticket-qr-code"
              />
              <Text style={styles.qrHint}>
                Present this QR code at the venue gate
              </Text>
            </View>
          ) : (
            <View style={styles.pendingGuard}>
              <Text style={styles.pendingQrMessage}>
                Payment pending — QR code will be available after payment is
                confirmed
              </Text>
            </View>
          )}
        </View>

        <View style={styles.perforationRow}>
          <View style={[styles.notch, styles.notchLeft]} />
          <View style={styles.dashedDivider} />
          <View style={[styles.notch, styles.notchRight]} />
        </View>

        <View style={styles.detailsSection}>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.detailLabel}>Attendee</Text>
              <Text style={styles.attendeeName}>{ticket.attendee_name}</Text>
              <Text style={styles.attendeeEmail}>{ticket.attendee_email}</Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>Back to My Tickets</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.canvas,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.elevated,
  },
  cardPadding: {
    padding: spacing.xxl,
  },
  passHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  passEyebrow: {
    ...typography.eyebrow,
    color: colors.primary,
    marginBottom: 2,
  },
  ticketCode: {
    ...typography.mono,
    fontSize: 16,
    color: colors.ink,
  },
  badge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  qrSection: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    alignItems: "center",
  },
  qrFrame: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  qrHint: {
    marginTop: spacing.md,
    ...typography.caption,
    textAlign: "center",
  },
  pendingGuard: {
    width: "100%",
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.input,
    padding: spacing.xl,
    alignItems: "center",
  },
  pendingQrMessage: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.warning,
    textAlign: "center",
    lineHeight: 20,
  },
  perforationRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    position: "relative",
  },
  notch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notchLeft: {
    marginLeft: -10,
  },
  notchRight: {
    marginRight: -10,
  },
  dashedDivider: {
    flex: 1,
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    marginHorizontal: spacing.xs,
  },
  detailsSection: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  infoGrid: {
    marginBottom: spacing.xl,
  },
  infoCell: {
    backgroundColor: colors.canvas,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  detailLabel: {
    ...typography.eyebrow,
    marginBottom: spacing.xs,
  },
  attendeeName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
  },
  attendeeEmail: {
    ...typography.bodyMuted,
    fontSize: 13,
    marginTop: 2,
  },
  title: {
    ...typography.h2,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodyMuted,
    marginBottom: spacing.xl,
  },
  backButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    ...shadows.subtle,
  },
  backButtonPressed: {
    backgroundColor: colors.primaryDark,
  },
  backButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "700",
  },
});
