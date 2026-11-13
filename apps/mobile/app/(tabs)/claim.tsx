import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import { colors, radii, shadows, spacing, typography } from "../../src/theme/tokens";

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
  const [focused, setFocused] = useState(false);
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
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.container}
      >
        <View style={styles.card}>
          <View style={styles.successBanner}>
            <Text style={styles.successTitle}>Ticket claimed!</Text>
            <Text style={styles.successSubtitle}>
              Your ticket has been added to your offline wallet.
            </Text>
          </View>

          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.detailLabel}>Ticket Code</Text>
              <Text style={styles.ticketCode}>{claimedTicket.ticket_code}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.detailLabel}>Attendee</Text>
              <Text style={styles.attendeeName}>
                {claimedTicket.attendee_name}
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push(`/tickets/${claimedTicket.ticket_code}`)}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>View Ticket QR</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
            onPress={() => router.push("/(tabs)")}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Go to My Tickets</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.scrollContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.eyebrowPill}>
            <Text style={styles.eyebrowPillText}>INVITATION CLAIM</Text>
          </View>
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
            style={[styles.input, focused && styles.inputFocused]}
            value={claimToken}
            onChangeText={setClaimToken}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Paste your claim token"
            placeholderTextColor={colors.inkSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
          />

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && !submitting && styles.buttonPressed,
              submitting && styles.buttonDisabled,
            ]}
            onPress={() => void handleSubmit()}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Claim Ticket</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.elevated,
  },
  eyebrowPill: {
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    marginBottom: spacing.md,
  },
  eyebrowPillText: {
    ...typography.eyebrow,
    color: colors.primary,
  },
  title: {
    ...typography.h1,
    fontSize: 22,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyMuted,
    marginBottom: spacing.xl,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  successBanner: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  successTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.success,
  },
  successSubtitle: {
    fontSize: 13,
    color: colors.inkMuted,
    marginTop: 4,
  },
  summaryBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  summaryRow: {
    gap: spacing.xs,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.xs + 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.canvas,
    marginBottom: spacing.lg,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  detailLabel: {
    ...typography.eyebrow,
  },
  ticketCode: {
    ...typography.mono,
    fontSize: 18,
    color: colors.ink,
  },
  attendeeName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    marginTop: spacing.xs,
    ...shadows.subtle,
  },
  buttonPressed: {
    backgroundColor: colors.primaryDark,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    marginTop: spacing.md,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.canvas,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
  },
});
