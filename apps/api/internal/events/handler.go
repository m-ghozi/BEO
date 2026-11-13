package events

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
)

type Handler struct {
	svc       *Service
	jwtSecret string
}

func NewHandler(svc *Service, jwtSecret string) *Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("events: jwtSecret cannot be empty")
	}
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := identity.AuthMiddleware(h.jwtSecret)

	mux.Handle("POST /v1/events", auth(http.HandlerFunc(h.handleCreateEvent)))
	mux.Handle("GET /v1/organizer/events", auth(http.HandlerFunc(h.handleListOrganizerEvents)))
	mux.HandleFunc("GET /v1/events", h.handleListEvents)
	mux.HandleFunc("GET /v1/events/{slug}", h.handleGetEventBySlug)
	mux.Handle("POST /v1/events/{eventID}/sessions", auth(http.HandlerFunc(h.handleAddSession)))
	mux.Handle("POST /v1/events/{eventID}/posts", auth(http.HandlerFunc(h.handlePublishPost)))
	mux.HandleFunc("GET /v1/events/{eventID}/sessions", h.handleListSessions)
	mux.HandleFunc("GET /v1/events/{eventID}/posts", h.handleListPosts)
}

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

func (h *Handler) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var in CreateEventInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	evt, err := h.svc.CreateEvent(r.Context(), claims.UserID, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidEventType), errors.Is(err, ErrInvalidInput):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrSlugExists):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to create event")
		}
		return
	}

	writeJSON(w, http.StatusCreated, evt)
}

func (h *Handler) handleListEvents(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0

	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	evts, err := h.svc.ListEvents(r.Context(), ListEventsOptions{
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list events")
		return
	}

	writeJSON(w, http.StatusOK, evts)
}

func (h *Handler) handleListOrganizerEvents(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	evts, err := h.svc.ListOrganizerEvents(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list organizer events")
		return
	}

	writeJSON(w, http.StatusOK, evts)
}

func (h *Handler) handleGetEventBySlug(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimSpace(r.PathValue("slug"))
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug is required")
		return
	}

	var evt Event
	var err error
	if _, parseErr := uuid.Parse(slug); parseErr == nil {
		evt, err = h.svc.GetEventByID(r.Context(), slug)
	} else {
		evt, err = h.svc.GetEventBySlug(r.Context(), slug)
	}
	if err != nil {
		if errors.Is(err, ErrEventNotFound) {
			writeError(w, http.StatusNotFound, "event not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get event")
		return
	}

	writeJSON(w, http.StatusOK, evt)
}

func (h *Handler) handleAddSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := strings.TrimSpace(r.PathValue("eventID"))
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "eventID is required")
		return
	}

	var in CreateSessionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sess, err := h.svc.AddSession(r.Context(), eventID, claims.UserID, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrForbidden):
			writeError(w, http.StatusForbidden, "forbidden: insufficient permissions")
		case errors.Is(err, ErrEventNotFound):
			writeError(w, http.StatusNotFound, "event not found")
		case errors.Is(err, ErrInvalidInput):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to add session")
		}
		return
	}

	writeJSON(w, http.StatusCreated, sess)
}

func (h *Handler) handlePublishPost(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := strings.TrimSpace(r.PathValue("eventID"))
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "eventID is required")
		return
	}

	var in CreatePostInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	post, err := h.svc.PublishPost(r.Context(), eventID, claims.UserID, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrForbidden):
			writeError(w, http.StatusForbidden, "forbidden: insufficient permissions")
		case errors.Is(err, ErrEventNotFound):
			writeError(w, http.StatusNotFound, "event not found")
		case errors.Is(err, ErrInvalidInput):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to publish post")
		}
		return
	}

	writeJSON(w, http.StatusCreated, post)
}

func (h *Handler) handleListSessions(w http.ResponseWriter, r *http.Request) {
	eventID := strings.TrimSpace(r.PathValue("eventID"))
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "eventID is required")
		return
	}

	sessions, err := h.svc.ListSessions(r.Context(), eventID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}

func (h *Handler) handleListPosts(w http.ResponseWriter, r *http.Request) {
	eventID := strings.TrimSpace(r.PathValue("eventID"))
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "eventID is required")
		return
	}

	posts, err := h.svc.ListPosts(r.Context(), eventID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list posts")
		return
	}

	writeJSON(w, http.StatusOK, posts)
}

