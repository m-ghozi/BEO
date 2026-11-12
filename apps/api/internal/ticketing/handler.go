package ticketing

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
)

type Handler struct {
	svc       *Service
	jwtSecret string
}

// NewHandler creates a new ticketing HTTP handler.
func NewHandler(svc *Service, jwtSecret string) *Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("ticketing: jwtSecret cannot be empty")
	}
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

// RegisterRoutes registers all ticketing routes on the provided ServeMux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := identity.AuthMiddleware(h.jwtSecret)

	mux.Handle("POST /v1/events/{eventID}/ticket-types", auth(http.HandlerFunc(h.handleCreateTicketType)))
	mux.HandleFunc("POST /v1/events/{eventID}/orders", h.handleReserveOrder)
	mux.Handle("POST /v1/events/{eventID}/agencies", auth(http.HandlerFunc(h.handleAllocateAgencyQuota)))
	mux.Handle("POST /v1/agency/events/{eventID}/issue", auth(http.HandlerFunc(h.handleIssueAgencyTickets)))
	mux.Handle("POST /v1/tickets/claim", auth(http.HandlerFunc(h.handleClaimTicket)))
	mux.Handle("GET /v1/me/tickets", auth(http.HandlerFunc(h.handleListMyTickets)))
	mux.HandleFunc("GET /v1/tickets/{ticketCode}/pdf", h.handleDownloadTicketPDF)
	mux.HandleFunc("GET /v1/tickets/{ticketCode}/qr.png", h.handleDownloadTicketQR)
}

// Routes returns an http.Handler with all ticketing routes registered.
func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return mux
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
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrTicketNotValid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrCFPRequired):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrEventNotFound), errors.Is(err, ErrTicketTypeNotFound), errors.Is(err, ErrUserNotFound), errors.Is(err, ErrInvalidClaimToken), errors.Is(err, ErrTicketNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrOutOfStock), errors.Is(err, ErrSalesClosed), errors.Is(err, ErrAgencyQuotaExceeded), errors.Is(err, ErrAlreadyClaimed):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (h *Handler) handleCreateTicketType(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	eventID := strings.TrimSpace(r.PathValue("eventID"))

	var in CreateTicketTypeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tt, err := h.svc.CreateTicketType(r.Context(), eventID, claims.UserID, in)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, tt)
}

func (h *Handler) handleReserveOrder(w http.ResponseWriter, r *http.Request) {
	eventID := strings.TrimSpace(r.PathValue("eventID"))

	var buyerUserID *string
	if authHeader := r.Header.Get("Authorization"); authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			writeError(w, http.StatusUnauthorized, "invalid authorization format")
			return
		}
		claims, err := identity.ParseJWT(parts[1], h.jwtSecret)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		buyerUserID = &claims.UserID
	}

	var in ReserveOrderInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	in.EventID = eventID
	in.BuyerUserID = buyerUserID

	ord, err := h.svc.ReserveOrder(r.Context(), in)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, ord)
}

func (h *Handler) handleAllocateAgencyQuota(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	eventID := strings.TrimSpace(r.PathValue("eventID"))

	var in AllocateAgencyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ea, err := h.svc.AllocateAgencyQuota(r.Context(), eventID, claims.UserID, in)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, ea)
}

func (h *Handler) handleIssueAgencyTickets(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	eventID := strings.TrimSpace(r.PathValue("eventID"))

	var in IssueAgencyTicketsInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tickets, err := h.svc.IssueAgencyTickets(r.Context(), claims.UserID, eventID, in)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, tickets)
}

func (h *Handler) handleClaimTicket(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		ClaimToken string `json:"claim_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tk, err := h.svc.ClaimTicket(r.Context(), claims.UserID, body.ClaimToken)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, tk)
}

func (h *Handler) handleListMyTickets(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	tickets, err := h.svc.ListMyTickets(r.Context(), claims.UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, tickets)
}

func (h *Handler) handleDownloadTicketQR(w http.ResponseWriter, r *http.Request) {
	ticketCode := strings.TrimSpace(r.PathValue("ticketCode"))
	if ticketCode == "" {
		writeError(w, http.StatusBadRequest, "ticketCode is required")
		return
	}

	qrPNG, err := h.svc.GetTicketQRPNG(r.Context(), ticketCode)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s-qr.png\"", ticketCode))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(qrPNG)
}

func (h *Handler) handleDownloadTicketPDF(w http.ResponseWriter, r *http.Request) {
	ticketCode := strings.TrimSpace(r.PathValue("ticketCode"))
	if ticketCode == "" {
		writeError(w, http.StatusBadRequest, "ticketCode is required")
		return
	}

	pdfBytes, err := h.svc.GetTicketPDFBytes(r.Context(), ticketCode)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.pdf\"", ticketCode))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdfBytes)
}
