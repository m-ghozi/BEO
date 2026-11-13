package cfp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
)

// Handler exposes HTTP endpoints for the Conference CFP workflow.
type Handler struct {
	svc       *Service
	jwtSecret string
}

// NewHandler creates a new CFP Handler.
func NewHandler(svc *Service, jwtSecret string) *Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("cfp: jwtSecret cannot be empty")
	}
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

// RegisterRoutes registers all CFP routes onto mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := identity.AuthMiddleware(h.jwtSecret)

	mux.Handle("POST /v1/events/{eventID}/cfp/submissions", auth(http.HandlerFunc(h.handleSubmitPaper)))
	mux.Handle("GET /v1/events/{eventID}/cfp/submissions", auth(http.HandlerFunc(h.handleListSubmissions)))
	mux.Handle("POST /v1/events/{eventID}/cfp/submissions/{submissionID}/assign", auth(http.HandlerFunc(h.handleAssignReviewer)))
	mux.Handle("POST /v1/cfp/submissions/{submissionID}/reviews", auth(http.HandlerFunc(h.handleSubmitReview)))
	mux.Handle("POST /v1/events/{eventID}/cfp/submissions/{submissionID}/decision", auth(http.HandlerFunc(h.handleDecideSubmission)))
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (h *Handler) handleServiceError(w http.ResponseWriter, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrEventNotFound), errors.Is(err, ErrSubmissionNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, fallbackMsg)
	}
}

func (h *Handler) handleSubmitPaper(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var in SubmitPaperInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sub, err := h.svc.SubmitPaper(r.Context(), r.PathValue("eventID"), claims.UserID, in)
	if err != nil {
		h.handleServiceError(w, err, "failed to submit paper")
		return
	}

	writeJSON(w, http.StatusCreated, sub)
}

func (h *Handler) handleListSubmissions(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	subs, err := h.svc.ListSubmissions(r.Context(), r.PathValue("eventID"), claims.UserID)
	if err != nil {
		h.handleServiceError(w, err, "failed to list submissions")
		return
	}

	writeJSON(w, http.StatusOK, subs)
}

func (h *Handler) handleAssignReviewer(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		ReviewerID string `json:"reviewer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.AssignReviewer(
		r.Context(),
		r.PathValue("eventID"),
		claims.UserID,
		r.PathValue("submissionID"),
		body.ReviewerID,
	); err != nil {
		h.handleServiceError(w, err, "failed to assign reviewer")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "assigned"})
}

func (h *Handler) handleSubmitReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		Score          int    `json:"score"`
		Comments       string `json:"comments"`
		Recommendation string `json:"recommendation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.SubmitReview(
		r.Context(),
		r.PathValue("submissionID"),
		claims.UserID,
		body.Score,
		body.Comments,
		body.Recommendation,
	); err != nil {
		h.handleServiceError(w, err, "failed to submit review")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "reviewed"})
}

func (h *Handler) handleDecideSubmission(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		Decision string `json:"decision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.DecideSubmission(
		r.Context(),
		r.PathValue("eventID"),
		claims.UserID,
		r.PathValue("submissionID"),
		body.Decision,
	); err != nil {
		h.handleServiceError(w, err, "failed to decide submission")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": body.Decision})
}
