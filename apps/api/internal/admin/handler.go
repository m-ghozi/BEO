package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
)

type Handler struct {
	svc       *Service
	jwtSecret string
}

// NewHandler creates a new platform admin HTTP handler.
func NewHandler(svc *Service, jwtSecret string) *Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("admin: jwtSecret cannot be empty")
	}
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

// RegisterRoutes registers all /v1/admin/* routes protected by AuthMiddleware and platform_admin guard.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := identity.AuthMiddleware(h.jwtSecret)
	guard := func(fn http.HandlerFunc) http.Handler {
		return auth(requirePlatformAdmin(fn))
	}

	mux.Handle("GET /v1/admin/overview", guard(h.handleGetOverview))
	mux.Handle("GET /v1/admin/events", guard(h.handleListEvents))
	mux.Handle("GET /v1/admin/users", guard(h.handleListUsers))
	mux.Handle("GET /v1/admin/commissions", guard(h.handleListCommissions))
	mux.Handle("PUT /v1/admin/commissions/{eventType}", guard(h.handleUpdateCommission))
	mux.Handle("GET /v1/admin/payouts", guard(h.handleListPayouts))
	mux.Handle("POST /v1/admin/payouts/{payoutID}/process", guard(h.handleProcessPayout))
	mux.Handle("GET /v1/admin/audit-events", guard(h.handleListAuditEvents))
}

// Routes returns an http.Handler with all admin routes registered.
func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return mux
}

func requirePlatformAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := identity.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if claims.AccountType != "platform_admin" {
			writeError(w, http.StatusForbidden, "platform_admin required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (h *Handler) handleGetOverview(w http.ResponseWriter, r *http.Request) {
	ov, err := h.svc.GetOverview(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load overview")
		return
	}
	writeJSON(w, http.StatusOK, ov)
}

func (h *Handler) handleListEvents(w http.ResponseWriter, r *http.Request) {
	evts, err := h.svc.ListEvents(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list events")
		return
	}
	writeJSON(w, http.StatusOK, evts)
}

func (h *Handler) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (h *Handler) handleListCommissions(w http.ResponseWriter, r *http.Request) {
	rates, err := h.svc.ListCommissions(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list commissions")
		return
	}
	writeJSON(w, http.StatusOK, rates)
}

type updateCommissionRequest struct {
	RatePercent *float64 `json:"rate_percent"`
}

func (h *Handler) handleUpdateCommission(w http.ResponseWriter, r *http.Request) {
	eventType := strings.TrimSpace(r.PathValue("eventType"))

	var req updateCommissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RatePercent == nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	updated, err := h.svc.UpdateCommission(r.Context(), eventType, *req.RatePercent)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidEventType), errors.Is(err, ErrInvalidCommissionRate):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to update commission")
		}
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) handleListPayouts(w http.ResponseWriter, r *http.Request) {
	payouts, err := h.svc.ListPayouts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list payouts")
		return
	}
	writeJSON(w, http.StatusOK, payouts)
}

type processPayoutRequest struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

func (h *Handler) handleProcessPayout(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	payoutID := strings.TrimSpace(r.PathValue("payoutID"))
	var req processPayoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	updated, err := h.svc.ProcessPayout(r.Context(), claims.UserID, payoutID, req.Action, req.Note)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrInvalidAction):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrPayoutNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrInvalidPayoutState):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to process payout")
		}
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) handleListAuditEvents(w http.ResponseWriter, r *http.Request) {
	events, err := h.svc.ListAuditEvents(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list audit events")
		return
	}
	writeJSON(w, http.StatusOK, events)
}
