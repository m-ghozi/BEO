import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ClaimTicketSchema, type TicketDTO } from "@beo/contracts";
import { useAuth } from "../../src/context/AuthContext";
import { apiFetch, ApiError } from "../../src/services/api";
import { saveTicketsCache } from "../../src/services/offlineCache";

function extractTokenFromUrl(url: string | null): string | null {
  if (!url) return null;
  const parsed = Linking.parse(url);
  const rawToken = parsed.queryParams?.token;
  if (typeof rawToken === "string" && rawToken.trim().length > 0) {
    return rawToken.trim();
  }
  return null;
}

/**
 * Ticket claim screen supporting manual token entry and beo://claim?token=... deep links.
 */
export default function ClaimScreen() {
  const { token: paramToken } = useLocalSearchParams<{ token?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [claimToken, setClaimToken] = useState(
    typeof paramToken === "string" ? paramToken : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedTicket, setClaimedTicket] = useState<TicketDTO | null>(null);

  useEffect(() => {
    if (typeof paramToken === "string" && paramToken.trim().length > 0) {
      setClaimToken(paramToken.trim());
    }
  }, [paramToken]);

  useEffect(() => {
    let active = true;

    void Linking.getInitialURL().then((url) => {
      if (!active) return;
      const urlToken = extractTokenFromUrl(url);
      if (urlToken) {
        setClaimToken(urlToken);
      }
    });

    const subscription = Linking.addEventListener("url", (event) => {
      const urlToken = extractTokenFromUrl(event.url);
      if (urlToken) {
        setClaimToken(urlToken);
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const handleSubmit = async () => {
    setError(null);
    const parsed = ClaimTicketSchema.safeParse({ claim_token: claimToken });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Claim token is required");
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await apiFetch<TicketDTO>("/v1/tickets/claim", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });

      if (user?.id) {
        try {
          const allTickets = await apiFetch<TicketDTO[]>("/v1/me/tickets");
          await saveTicketsCache(
            user.id,
            Array.isArray(allTickets) ? allTickets : [ticket]
          );
        } catch {
          await saveTicketsCache(user.id, [ticket]);
        }
      }

      setClaimedTicket(ticket);
    } catch (err) {
      if (err instanceof ApiError || err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to claim ticket. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (claimedTicket) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.successBanner}>
            <Text style={styles.successTitle}>Ticket claimed!</Text>
            <Text style={styles.successSubtitle}>
              Your ticket has been added to your offline wallet.
            </Text>
          </View>

          <Text style={styles.detailLabel}>Ticket Code</Text>
          <Text style={styles.ticketCode}>{claimedTicket.ticket_code}</Text>

          <Text style={styles.detailLabel}>Attendee</Text>
          <Text style={styles.attendeeName}>{claimedTicket.attendee_name}</Text>

          <Pressable
            style={styles.button}
            onPress={() => router.push(`/tickets/${claimedTicket.ticket_code}`)}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>View Ticket QR</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push("/(tabs)")}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Go to My Tickets</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Claim Ticket</Text>
        <Text style={styles.subtitle}>
          Enter the claim token from your invitation email or open a claim link.
        </Text>

        {error ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Claim Token</Text>
        <TextInput
          style={styles.input}
          value={claimToken}
          onChangeText={setClaimToken}
          placeholder="Paste your claim token"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
        />

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Claim Ticket</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
  },
  errorBanner: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 14,
  },
  successBanner: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#047857",
  },
  successSubtitle: {
    fontSize: 13,
    color: "#065f46",
    marginTop: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#ffffff",
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  ticketCode: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 14,
  },
  attendeeName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 20,
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryButtonText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "600",
  },
});
