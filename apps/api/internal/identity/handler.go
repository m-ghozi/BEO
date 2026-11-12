package identity

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Handler struct {
	svc       *Service
	jwtSecret string
}

func NewHandler(svc *Service, jwtSecret string) *Handler {
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := AuthMiddleware(h.jwtSecret)

	mux.HandleFunc("POST /v1/auth/register", h.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", h.handleLogin)
	mux.Handle("POST /v1/me/push-token", auth(http.HandlerFunc(h.handleRegisterPushToken)))
	mux.Handle("POST /v1/events/{eventID}/members", auth(http.HandlerFunc(h.handleAssignEventMember)))
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return mux
}

type authResponse struct {
	User  User   `json:"user"`
	Token string `json:"token"`
}

type statusResponse struct {
	Status string `json:"status"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	var in RegisterInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, token, err := h.svc.Register(r.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidAccountType), errors.Is(err, ErrInvalidInput):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrEmailExists):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to register user")
		}
		return
	}

	writeJSON(w, http.StatusCreated, authResponse{
		User:  user,
		Token: token,
	})
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, token, err := h.svc.Login(r.Context(), in.Email, in.Password)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to login")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		User:  user,
		Token: token,
	})
}

func (h *Handler) handleRegisterPushToken(w http.ResponseWriter, r *http.Request) {
	claims, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var in struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(in.Token) == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	if err := h.svc.RegisterPushToken(r.Context(), claims.UserID, in.Token); err != nil {
		if errors.Is(err, ErrUserNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to register push token")
		return
	}

	writeJSON(w, http.StatusOK, statusResponse{Status: "ok"})
}

func (h *Handler) handleAssignEventMember(w http.ResponseWriter, r *http.Request) {
	claims, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := strings.TrimSpace(r.PathValue("eventID"))
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "eventID is required")
		return
	}

	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	err := h.svc.AssignEventMember(r.Context(), eventID, claims.UserID, in.Email, in.Role)
	if err != nil {
		switch {
		case errors.Is(err, ErrForbidden):
			writeError(w, http.StatusForbidden, "forbidden: only organizer can assign event members")
		case errors.Is(err, ErrInvalidRole):
			writeError(w, http.StatusBadRequest, "invalid role: allowed roles are co_organizer, reviewer, checkin_staff")
		case errors.Is(err, ErrEventNotFound):
			writeError(w, http.StatusNotFound, "event not found")
		case errors.Is(err, ErrUserNotFound):
			writeError(w, http.StatusNotFound, "user not found")
		default:
			writeError(w, http.StatusInternalServerError, "failed to assign event member")
		}
		return
	}

	writeJSON(w, http.StatusCreated, statusResponse{Status: "ok"})
}
