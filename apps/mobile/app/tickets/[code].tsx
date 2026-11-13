import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import type { TicketDTO } from "@beo/contracts";
import { useAuth } from "../../src/context/AuthContext";
import { loadTicketsCache } from "../../src/services/offlineCache";
import { getTicketStatusMeta } from "../../src/features/tickets/ticketStatus";

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
        const match =
          cached?.tickets.find((item) => item.ticket_code === code) ?? null;
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
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Text style={styles.title}>Ticket not found</Text>
          <Text style={styles.subtitle}>
            This ticket is not in your offline cache yet. Return to My Tickets and
            pull to refresh while online.
          </Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const statusMeta = getTicketStatusMeta(ticket);
  const qrValue = ticket.qr_signature || ticket.ticket_code;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
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
          <Text style={styles.ticketCode}>{ticket.ticket_code}</Text>
        </View>

        <View style={styles.qrWrapper}>
          <QRCode value={qrValue} size={220} testID="ticket-qr-code" />
          <Text style={styles.qrHint}>Present this QR code at the venue gate</Text>
        </View>

        <View style={styles.detailsSection}>
          <Text style={styles.detailLabel}>Attendee</Text>
          <Text style={styles.attendeeName}>{ticket.attendee_name}</Text>
          <Text style={styles.attendeeEmail}>{ticket.attendee_email}</Text>
        </View>

        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={styles.backButtonText}>Back to My Tickets</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    justifyContent: "center",
    padding: 20,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: "#f9fafb",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
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
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  qrWrapper: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 20,
    marginBottom: 20,
  },
  qrHint: {
    marginTop: 12,
    fontSize: 12,
    color: "#6b7280",
  },
  detailsSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  attendeeName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  attendeeEmail: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  backButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});
