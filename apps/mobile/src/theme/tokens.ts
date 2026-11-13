import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * Unified design tokens for @beo/mobile ("Event-Tech Editorial Precision").
 */
export const colors = {
  primary: "#4F46E5",
  primaryDark: "#4338CA",
  primarySoft: "#EEF2FF",
  canvas: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F5F9",
  ink: "#0F172A",
  inkMuted: "#475569",
  inkSubtle: "#64748B",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  success: "#059669",
  successSoft: "#ECFDF5",
  successBorder: "#A7F3D0",
  warning: "#D97706",
  warningSoft: "#FFFBEB",
  warningBorder: "#FDE68A",
  danger: "#E11D48",
  dangerSoft: "#FFF1F2",
  dangerBorder: "#FECDD3",
  white: "#FFFFFF",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 8,
  input: 12,
  button: 12,
  card: 16,
  pill: 999,
} as const;

const monoFontFamily = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export const typography: Record<string, TextStyle> = {
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.inkSubtle,
  },
  h1: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: colors.ink,
  },
  h2: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.ink,
  },
  h3: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  bodyMuted: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkMuted,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSubtle,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  mono: {
    fontFamily: monoFontFamily,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: colors.ink,
  },
};

export const shadows: Record<"subtle" | "card" | "elevated", ViewStyle> = {
  subtle: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  elevated: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
};

export const statusBadgeVariants = {
  valid: {
    bg: colors.successSoft,
    text: colors.success,
    border: colors.successBorder,
  },
  pending: {
    bg: colors.warningSoft,
    text: colors.warning,
    border: colors.warningBorder,
  },
  checkedIn: {
    bg: colors.surfaceMuted,
    text: colors.inkMuted,
    border: colors.border,
  },
  cancelled: {
    bg: colors.dangerSoft,
    text: colors.danger,
    border: colors.dangerBorder,
  },
} as const;
