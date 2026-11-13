# BEO Attendee Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lightweight Expo (React Native + TypeScript) attendee mobile app in `apps/mobile` for Android and iOS, featuring offline QR ticket access, claim-token deep linking, event schedules/announcements, and Expo Push Notifications.

**Architecture:** Expo Router (`apps/mobile/app/`) backed by `@beo/contracts` shared TypeScript DTOs/Zod schemas, `expo-secure-store` for JWT persistence, `AsyncStorage` for offline ticket & schedule caching, `react-native-qrcode-svg` for offline QR rendering from `qr_payload`, and `expo-notifications` wired to `POST /v1/me/push-token`.

**Tech Stack:** Expo SDK 52, React Native, TypeScript, Expo Router, `expo-secure-store`, `@react-native-async-storage/async-storage`, `expo-notifications`, `expo-device`, `expo-linking`, `react-native-qrcode-svg`, `react-native-svg`, `@beo/contracts`, Jest (`jest-expo`) + `@testing-library/react-native`.

**Spec:** [2026-11-13-beo-design.md](file:///home/mriza/Projects/cerdas.club/BEO/docs/superpowers/specs/2026-11-13-beo-design.md)

## Global Constraints

- Attendee-only mobile app: organizer studio, agency portal, CFP review, and venue check-in scanner belong exclusively in `apps/web` (Spec §1, §6.6).
- Offline QR access: claimed tickets and their `qr_payload` must be cached locally so QR codes render without network connectivity at the venue gate (Spec §2, §6.6).
- Deep-link & manual claim: attendees can claim tickets via `claim_token` input or `beo://claim?token=...` deep link (`POST /v1/tickets/claim`) (Spec §6.4, §6.6).
- Push notifications: register Expo push token via `POST /v1/me/push-token` (`{ token }`) when permitted; gracefully handle denied permissions or simulator/non-device environments without crashing (Spec §6.6).
- Shared contracts: reuse DTOs and Zod schemas from `@beo/contracts` instead of duplicating API types (Spec §3 Approach B).

## Review Focus

1. **Offline Ticket Gate Access:** When `GET /v1/me/tickets` fails due to offline/network error, `MyTickets` renders previously cached tickets with an explicit offline indicator and `/tickets/[code]` still renders the QR code from cached `qr_payload`.
2. **401 Token Expiry Handling:** When `apiFetch` receives HTTP `401`, it clears the stored JWT from `SecureStore` and notifies `AuthContext` so the user is redirected to `/(auth)/login`.
3. **Push Permission Denial / Simulator Safety:** Calling `registerForPushNotificationsAsync` on a simulator (`!Device.isDevice`) or when notification permissions are denied returns `null` cleanly without throwing or blocking login.
4. **Deep-Link Claim Token Pre-fill:** Opening `/(tabs)/claim?token=ABC123` (or `beo://claim?token=ABC123`) pre-fills the claim input and allows claiming via `POST /v1/tickets/claim`.
5. **Notification Tap Navigation:** Tapping a push notification containing `data.event_slug` or `data.claim_token` navigates to `/events/[slug]` or `/(tabs)/claim?token=...`.

---

### Task 1: Expo Mobile Scaffold, `@beo/contracts` Integration, API Client & Offline Cache

**Files:**
- Modify: `package.json` (add `"apps/mobile"` to `workspaces`)
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/jest.config.js`
- Create: `apps/mobile/jest.setup.ts`
- Create: `apps/mobile/src/services/api.ts`
- Create: `apps/mobile/src/services/offlineCache.ts`
- Test: `apps/mobile/src/services/api.test.ts`
- Test: `apps/mobile/src/services/offlineCache.test.ts`

**Interfaces:**
- Consumes: `@beo/contracts` (`TicketDTO`, `EventDTO`, `SessionDTO`, `EventPostDTO`, `AuthResponseDTO`)
- Produces:
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`
  - `setUnauthorizedHandler(fn: (() => void) | null): void`
  - `getStoredToken(): Promise<string | null>`
  - `setStoredToken(token: string | null): Promise<void>`
  - `saveTicketsCache(userId: string, tickets: TicketDTO[]): Promise<void>`
  - `loadTicketsCache(userId: string): Promise<{ tickets: TicketDTO[]; updatedAt: string } | null>`
  - `saveEventDetailCache(slug: string, detail: CachedEventDetail): Promise<void>`
  - `loadEventDetailCache(slug: string): Promise<CachedEventDetail | null>`

- [ ] **Step 1: Add `apps/mobile` to root `package.json` workspaces and scaffold `apps/mobile` config files** (`package.json`, `app.json` with `"scheme": "beo"`, `tsconfig.json` extending `expo/tsconfig.base`, `jest.config.js` with `jest-expo`, `jest.setup.ts` mocking `expo-secure-store`, `@react-native-async-storage/async-storage`, `expo-notifications`, `expo-device`, `expo-router`).
- [ ] **Step 2: Write failing tests in `apps/mobile/src/services/api.test.ts` and `apps/mobile/src/services/offlineCache.test.ts`** covering JWT header attachment, `401` clearing token + triggering unauthorized handler, and `AsyncStorage` ticket/event cache round-trip.
- [ ] **Step 3: Run tests to verify they fail** (`npm test --workspace=@beo/mobile`).
- [ ] **Step 4: Implement `apps/mobile/src/services/api.ts` and `apps/mobile/src/services/offlineCache.ts`**.
- [ ] **Step 5: Run tests and TypeScript check** (`npm test --workspace=@beo/mobile && npx --workspace=@beo/mobile tsc --noEmit`).
- [ ] **Step 6: Commit** (`feat(mobile): scaffold expo app with api client and offline cache`).

---

### Task 2: Auth Context, Login/Register Screens & Push Notification Registration

**Files:**
- Create: `apps/mobile/src/services/notifications.ts`
- Create: `apps/mobile/src/context/AuthContext.tsx`
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/app/(auth)/register.tsx`
- Test: `apps/mobile/src/services/notifications.test.ts`
- Test: `apps/mobile/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `setStoredToken`, `getStoredToken`, `setUnauthorizedHandler` from Task 1; `LoginSchema`, `RegisterSchema`, `AuthResponseDTO`, `UserDTO` from `@beo/contracts`
- Produces:
  - `registerForPushNotificationsAsync(): Promise<string | null>`
  - `AuthProvider`, `useAuth(): { user: UserDTO | null; token: string | null; isLoading: boolean; login(email: string, password: string): Promise<void>; register(name: string, email: string, password: string): Promise<void>; logout(): Promise<void>; syncPushToken(): Promise<string | null> }`

- [ ] **Step 1: Write failing tests** for `notifications.ts` (returns `null` when `!Device.isDevice` or permission denied; returns Expo push token when granted) and `AuthContext.test.tsx` (restores session, registers push token via `POST /v1/me/push-token` on login, clears session on `401` or `logout`).
- [ ] **Step 2: Run tests to verify failure**.
- [ ] **Step 3: Implement `notifications.ts`, `AuthContext.tsx`, `app/_layout.tsx`, `app/(auth)/login.tsx`, and `app/(auth)/register.tsx`**.
- [ ] **Step 4: Run tests and `tsc --noEmit`** to verify pass.
- [ ] **Step 5: Commit** (`feat(mobile): add auth context, login/register screens, and push registration`).

---

### Task 3: Offline Ticket Wallet, QR Code Display & Deep-Link Token Claim

**Files:**
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx` (My Tickets)
- Create: `apps/mobile/app/tickets/[code].tsx` (Offline QR Ticket View)
- Create: `apps/mobile/app/(tabs)/claim.tsx` (Claim Ticket via input or deep link)
- Test: `apps/mobile/src/features/tickets/MyTicketsScreen.test.tsx`
- Test: `apps/mobile/src/features/tickets/ClaimScreen.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `apiFetch`, `saveTicketsCache`, `loadTicketsCache`, `TicketDTO`, `ClaimTicketSchema`
- Produces:
  - Tab navigation (`My Tickets`, `Events`, `Claim`, `Profile`)
  - Offline QR rendering via `react-native-qrcode-svg` using `ticket.qr_payload`
  - Claim flow via `POST /v1/tickets/claim` with `claim_token` query param pre-fill

- [ ] **Step 1: Write failing tests** for `MyTicketsScreen` (fetches `GET /v1/me/tickets` and caches; falls back to cached tickets with `"Offline Mode"` banner on network error; navigates to QR view) and `ClaimScreen` (pre-fills `token` param from deep link, validates non-empty token, calls `POST /v1/tickets/claim`).
- [ ] **Step 2: Run tests to verify failure**.
- [ ] **Step 3: Implement `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `tickets/[code].tsx`, and `(tabs)/claim.tsx`**.
- [ ] **Step 4: Run tests and `tsc --noEmit`** to verify pass.
- [ ] **Step 5: Commit** (`feat(mobile): add offline ticket wallet, QR display, and claim flow`).

---

### Task 4: Event Schedule, Organizer Announcements, Profile & Notification Deep-Linking

**Files:**
- Create: `apps/mobile/app/(tabs)/events.tsx` (Events Directory)
- Create: `apps/mobile/app/events/[slug].tsx` (Event Detail: Schedule & Organizer Posts)
- Create: `apps/mobile/app/(tabs)/profile.tsx` (Account & Push Settings)
- Modify: `apps/mobile/app/_layout.tsx` (add `Notifications.addNotificationResponseReceivedListener` routing)
- Test: `apps/mobile/src/features/events/EventDetailScreen.test.tsx`
- Test: `apps/mobile/src/services/notificationRouting.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `saveEventDetailCache`, `loadEventDetailCache`, `useAuth`, `EventDTO`, `SessionDTO`, `EventPostDTO`
- Produces:
  - `resolveNotificationRoute(data: Record<string, unknown> | undefined): string | null` (maps `event_slug` -> `/events/${slug}`, `claim_token` -> `/(tabs)/claim?token=${token}`)
  - Offline-cached event schedule & organizer announcements screen

- [ ] **Step 1: Write failing tests** for `EventDetailScreen` (renders sessions and organizer posts from API, falls back to `loadEventDetailCache` offline) and `resolveNotificationRoute` (routes `event_slug` and `claim_token` payloads).
- [ ] **Step 2: Run tests to verify failure**.
- [ ] **Step 3: Implement `(tabs)/events.tsx`, `events/[slug].tsx`, `(tabs)/profile.tsx`, and wire notification response listener in `app/_layout.tsx`**.
- [ ] **Step 4: Run full verification** (`npm test --workspace=@beo/mobile && npx --workspace=@beo/mobile tsc --noEmit`).
- [ ] **Step 5: Commit** (`feat(mobile): add event schedule, announcements, profile, and push routing`).
