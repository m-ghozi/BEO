import { z } from "zod";

// --- Enums and Constants ---

export const EVENT_TYPES = [
  "community",
  "seminar_workshop",
  "conference",
  "meetup_ted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const ACCOUNT_TYPES = [
  "standard",
  "agency",
  "platform_admin",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const EVENT_STATUSES = [
  "draft",
  "published",
  "completed",
  "cancelled",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  "free",
  "duitku",
  "manual_transfer",
  "agency_issued",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "pending_verification",
  "paid",
  "expired",
  "rejected",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Zod Schemas ---

export const RegisterSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  account_type: z.enum(["standard", "agency"]).default("standard"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  slug: z
    .string()
    .trim()
    .regex(SLUG_REGEX, "Slug must be lowercase alphanumeric words separated by single hyphens"),
  event_type: z.enum(EVENT_TYPES),
  start_at: z.string().min(1, "Start time is required"),
  end_at: z.string().min(1, "End time is required"),
  venue: z.string().trim().min(1, "Venue is required"),
  modules_enabled: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const AttendeeSchema = z.object({
  name: z.string().trim().min(1, "Attendee name is required"),
  email: z.string().trim().email("Valid attendee email is required"),
});

export type AttendeeInput = z.infer<typeof AttendeeSchema>;

export const ReserveOrderSchema = z.object({
  ticket_type_id: z.string().min(1, "Ticket type ID is required"),
  buyer_email: z.string().trim().email("Valid buyer email is required"),
  buyer_user_id: z.string().optional(),
  payment_method: z.enum(["free", "duitku", "manual_transfer"]).or(z.string()),
  attendees: z
    .array(AttendeeSchema)
    .min(1, "At least 1 attendee is required"),
});

export type ReserveOrderInput = z.infer<typeof ReserveOrderSchema>;

export const ClaimTicketSchema = z.object({
  claim_token: z.string().trim().min(1, "Claim token is required"),
});

export type ClaimTicketInput = z.infer<typeof ClaimTicketSchema>;

export const CreateTicketTypeSchema = z.object({
  name: z.string().trim().min(1, "Ticket type name is required"),
  price: z.number().min(0, "Price must be non-negative"),
  currency: z.string().default("IDR"),
  quota: z.number().int().min(1, "Quota must be at least 1"),
  requires_accepted_cfp: z.boolean().default(false),
  sales_start_at: z.string().nullable().optional(),
  sales_end_at: z.string().min(1, "Sales end date is required"),
});

export type CreateTicketTypeInput = z.infer<typeof CreateTicketTypeSchema>;

export const CreateSessionSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  speaker_name: z.string().trim().min(1, "Speaker name is required"),
  speaker_bio: z.string().default(""),
  start_at: z.string().min(1, "Start time is required"),
  end_at: z.string().min(1, "End time is required"),
  room_or_stage: z.string().default(""),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

export const CreatePostSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  body: z.string().trim().min(1, "Body is required"),
  notify_push: z.boolean().default(false),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const AllocateAgencyQuotaSchema = z.object({
  agency_user_id: z.string().min(1, "Agency user ID is required"),
  ticket_type_id: z.string().min(1, "Ticket type ID is required"),
  quota_limit: z.number().int().min(1, "Quota limit must be at least 1"),
});

export type AllocateAgencyQuotaInput = z.infer<typeof AllocateAgencyQuotaSchema>;

export const IssueAgencyTicketsSchema = z.object({
  ticket_type_id: z.string().min(1, "Ticket type ID is required"),
  attendees: z.array(AttendeeSchema).min(1, "At least 1 attendee is required"),
});

export type IssueAgencyTicketsInput = z.infer<typeof IssueAgencyTicketsSchema>;

export const PayoutRequestSchema = z.object({
  amount: z.number().int().positive("Amount must be greater than 0"),
  bank_name: z.string().trim().min(1, "Bank name is required"),
  bank_account_number: z.string().trim().min(1, "Bank account number is required"),
  bank_account_name: z.string().trim().min(1, "Bank account name is required"),
});

export type PayoutRequestInput = z.infer<typeof PayoutRequestSchema>;

export const ManualPaymentVerificationSchema = z.object({
  approve: z.boolean(),
  reason: z.string().optional(),
}).refine(
  (data) => data.approve || (data.reason && data.reason.trim().length > 0),
  {
    message: "A rejection reason is required when rejecting payment",
    path: ["reason"],
  }
);

export type ManualPaymentVerificationInput = z.infer<typeof ManualPaymentVerificationSchema>;

export const CFPSubmissionInputSchema = z.object({
  track: z.string().trim().min(1, "Track is required"),
  title: z.string().trim().min(1, "Paper title is required"),
  abstract: z.string().trim().min(1, "Abstract is required"),
  file_url: z.string().trim().url("Valid file URL is required"),
});

export type CFPSubmissionInput = z.infer<typeof CFPSubmissionInputSchema>;

export const CFPReviewInputSchema = z.object({
  score: z.number().int().min(1).max(10, "Score must be between 1 and 10"),
  comments: z.string().trim().min(1, "Comments are required"),
  recommendation: z.string().trim().min(1, "Recommendation is required"),
});

export type CFPReviewInput = z.infer<typeof CFPReviewInputSchema>;

export const CFPDecisionInputSchema = z.object({
  decision: z.enum(["accepted", "rejected", "revision_required"]),
});

export type CFPDecisionInput = z.infer<typeof CFPDecisionInputSchema>;

export const CheckinScanSchema = z.object({
  qr_payload: z.string().trim().min(1, "QR payload is required"),
  scan_mode: z.enum(["hid", "webcam"]),
});

export type CheckinScanInput = z.infer<typeof CheckinScanSchema>;

// --- Data Transfer Objects (DTOs) ---

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  account_type: AccountType;
  expo_push_tokens?: string[];
  created_at: string;
}

export interface AuthResponse {
  user: UserDTO;
  token: string;
}

export interface SessionDTO {
  id: string;
  event_id: string;
  title: string;
  speaker_name: string;
  speaker_bio: string;
  start_at: string;
  end_at: string;
  room_or_stage: string;
  created_at: string;
}

export interface PostDTO {
  id: string;
  event_id: string;
  author_id: string;
  title: string;
  body: string;
  notify_push: boolean;
  published_at: string;
  created_at?: string;
}

export interface EventDTO {
  id: string;
  organizer_id: string;
  title: string;
  slug: string;
  event_type: EventType;
  modules_enabled?: Record<string, unknown>;
  start_at: string;
  end_at: string;
  venue: string;
  status: EventStatus;
  created_at: string;
  sessions?: SessionDTO[];
}

export interface TicketTypeDTO {
  id: string;
  event_id: string;
  name: string;
  price: number;
  currency: string;
  quota: number;
  allocated_agency_quota?: number;
  sold_count?: number;
  reserved_count?: number;
  requires_accepted_cfp: boolean;
  sales_start_at?: string | null;
  sales_end_at: string;
  created_at?: string;
}

export interface TicketDTO {
  id: string;
  order_id?: string | null;
  ticket_type_id: string;
  event_id: string;
  agency_id?: string | null;
  attendee_name: string;
  attendee_email: string;
  ticket_code: string;
  qr_signature: string;
  claim_token?: string | null;
  claimed_by_user_id?: string | null;
  status: string;
  checked_in_at?: string | null;
  checked_in_by?: string | null;
  created_at: string;
}

export interface OrderDTO {
  id: string;
  event_id: string;
  buyer_user_id?: string | null;
  agency_id?: string | null;
  buyer_email: string;
  total_amount: number;
  payment_method: PaymentMethod | string;
  payment_status: PaymentStatus | string;
  duitku_reference?: string | null;
  proof_file_url?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at?: string;
  tickets?: TicketDTO[];
}

export interface CFPSubmissionDTO {
  id: string;
  event_id: string;
  author_user_id: string;
  track: string;
  title: string;
  abstract: string;
  file_url: string;
  status: "submitted" | "under_review" | "revision_required" | "accepted" | "rejected" | string;
  created_at: string;
  updated_at?: string;
}

export interface CFPReviewDTO {
  id: string;
  submission_id: string;
  reviewer_user_id: string;
  score: number;
  comments: string;
  recommendation: string;
  created_at: string;
}

export interface WalletDTO {
  balance: number;
}

export interface CheckinResultDTO {
  ticket_id?: string;
  ticket_code?: string;
  attendee_name?: string;
  attendee_email?: string;
  checked_in_at?: string;
  result: "success" | "duplicate" | "invalid" | string;
}

export interface EventAgencyDTO {
  id: string;
  event_id: string;
  agency_user_id: string;
  ticket_type_id: string;
  quota_limit: number;
  issued_count: number;
  status: string;
  created_at: string;
}

export interface PayoutRequestDTO {
  id: string;
  organizer_id: string;
  amount: number;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  status: string;
  processed_at?: string | null;
  created_at: string;
}
