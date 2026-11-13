package checkin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
)

// Handler exposes HTTP endpoints for venue check-in operations.
type Handler struct {
	svc       *Service
	jwtSecret string
}

// NewHandler creates a new check-in HTTP handler.
func NewHandler(svc *Service, jwtSecret string) *Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("checkin: jwtSecret cannot be empty")
	}
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

// RegisterRoutes registers all check-in routes on the provided ServeMux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := identity.AuthMiddleware(h.jwtSecret)
	mux.Handle("POST /v1/events/{eventID}/checkin", auth(http.HandlerFunc(h.handleScanQR)))
}

// Routes returns an http.Handler with all check-in routes registered.
func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return mux
}

type scanQRRequest struct {
	QRPayload string `json:"qr_payload"`
	ScanMode  string `json:"scan_mode"`
}

func (h *Handler) handleScanQR(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := strings.TrimSpace(r.PathValue("eventID"))
	var req scanQRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ip := extractClientIP(r)
	res, err := h.svc.ScanQR(r.Context(), eventID, claims.UserID, req.QRPayload, req.ScanMode, ip, r.UserAgent())
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, res)
}

func extractClientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	return r.RemoteAddr
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrInvalidTicket):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrDuplicateScan):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
