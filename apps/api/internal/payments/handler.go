package payments

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ledger"
)

const maxProofUploadBytes = 5 << 20 // 5MB

type Handler struct {
	svc        *Service
	ledgerSvc  *ledger.Service
	jwtSecret  string
	storageDir string
}

// NewHandler creates a new payments HTTP handler.
func NewHandler(svc *Service, ledgerSvc *ledger.Service, jwtSecret string, storageDir ...string) *Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("payments: jwtSecret cannot be empty")
	}
	dir := "./uploads"
	if len(storageDir) > 0 && strings.TrimSpace(storageDir[0]) != "" {
		dir = strings.TrimSpace(storageDir[0])
	}
	return &Handler{
		svc:        svc,
		ledgerSvc:  ledgerSvc,
		jwtSecret:  jwtSecret,
		storageDir: dir,
	}
}

// RegisterRoutes registers all payments and organizer wallet/payout routes on mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	auth := identity.AuthMiddleware(h.jwtSecret)

	mux.HandleFunc("POST /v1/orders/{orderID}/pay/duitku", h.handleInitiateDuitku)
	mux.HandleFunc("POST /v1/webhooks/duitku", h.handleDuitkuWebhook)
	mux.HandleFunc("POST /v1/orders/{orderID}/proof", h.handleSubmitManualProof)
	mux.HandleFunc("POST /v1/orders/{orderID}/proof-upload", h.handleUploadManualProof)
	mux.HandleFunc("GET /v1/uploads/{filename}", h.handleServeUpload)
	mux.Handle("POST /v1/orders/{orderID}/verify", auth(http.HandlerFunc(h.handleVerifyManualOrder)))
	mux.Handle("GET /v1/organizer/wallet", auth(http.HandlerFunc(h.handleGetWallet)))
	mux.Handle("GET /v1/organizer/payouts", auth(http.HandlerFunc(h.handleListPayouts)))
	mux.Handle("POST /v1/organizer/payouts", auth(http.HandlerFunc(h.handleRequestPayout)))
}

// Routes returns an http.Handler with all payments routes registered.
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
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrAmountMismatch), errors.Is(err, ledger.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrInvalidSignature):
		writeError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrOrderNotFound), errors.Is(err, ledger.ErrOrderNotFound), errors.Is(err, ledger.ErrOrganizerNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrInvalidOrderState), errors.Is(err, ledger.ErrInsufficientBalance):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (h *Handler) handleInitiateDuitku(w http.ResponseWriter, r *http.Request) {
	orderID := strings.TrimSpace(r.PathValue("orderID"))
	paymentURL, err := h.svc.InitiateDuitku(r.Context(), orderID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"payment_url": paymentURL})
}

func (h *Handler) handleDuitkuWebhook(w http.ResponseWriter, r *http.Request) {
	var payload DuitkuCallback
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(ct, "application/x-www-form-urlencoded") {
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, "invalid form body")
			return
		}
		payload = DuitkuCallback{
			MerchantCode:    r.FormValue("merchantCode"),
			Amount:          r.FormValue("amount"),
			MerchantOrderID: r.FormValue("merchantOrderId"),
			ProductDetail:   r.FormValue("productDetail"),
			AdditionalParam: r.FormValue("additionalParam"),
			PaymentCode:     r.FormValue("paymentCode"),
			ResultCode:      r.FormValue("resultCode"),
			MerchantUserID:  r.FormValue("merchantUserId"),
			Reference:       r.FormValue("reference"),
			Signature:       r.FormValue("signature"),
		}
	} else {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	if err := h.svc.HandleDuitkuWebhook(r.Context(), payload); err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) handleSubmitManualProof(w http.ResponseWriter, r *http.Request) {
	orderID := strings.TrimSpace(r.PathValue("orderID"))

	var body struct {
		ProofURL     string `json:"proof_url"`
		ProofFileURL string `json:"proof_file_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	proofURL := strings.TrimSpace(body.ProofURL)
	if proofURL == "" {
		proofURL = strings.TrimSpace(body.ProofFileURL)
	}

	if err := h.svc.SubmitManualProof(r.Context(), orderID, proofURL); err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "pending_verification"})
}

func (h *Handler) handleVerifyManualOrder(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orderID := strings.TrimSpace(r.PathValue("orderID"))

	var body struct {
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.VerifyManualOrder(r.Context(), orderID, claims.UserID, body.Approve, body.Reason); err != nil {
		writeServiceError(w, err)
		return
	}
	status := "rejected"
	if body.Approve {
		status = "paid"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

func (h *Handler) handleGetWallet(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	balance, err := h.ledgerSvc.GetBalance(r.Context(), claims.UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"balance": balance})
}

func (h *Handler) handleRequestPayout(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var in ledger.PayoutInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	pr, err := h.ledgerSvc.RequestPayout(r.Context(), claims.UserID, in)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, pr)
}

func (h *Handler) handleListPayouts(w http.ResponseWriter, r *http.Request) {
	claims, ok := identity.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	payouts, err := h.ledgerSvc.ListPayouts(r.Context(), claims.UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payouts)
}

func isAllowedProofExtension(ext string) bool {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg", ".png", ".webp", ".pdf":
		return true
	default:
		return false
	}
}

func (h *Handler) handleUploadManualProof(w http.ResponseWriter, r *http.Request) {
	orderID := strings.TrimSpace(r.PathValue("orderID"))
	if orderID == "" {
		writeError(w, http.StatusBadRequest, "orderID is required")
		return
	}

	// Allow 5MB file plus multipart overhead.
	r.Body = http.MaxBytesReader(w, r.Body, maxProofUploadBytes+64*1024)
	if err := r.ParseMultipartForm(maxProofUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or invalid multipart form (max 5MB)")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()

	if header.Size > maxProofUploadBytes {
		writeError(w, http.StatusBadRequest, "file exceeds 5MB limit")
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !isAllowedProofExtension(ext) {
		writeError(w, http.StatusBadRequest, "unsupported file type: allowed .jpg, .jpeg, .png, .webp, .pdf")
		return
	}

	if err := os.MkdirAll(h.storageDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to prepare storage directory")
		return
	}

	filename := uuid.NewString() + ext
	dstPath := filepath.Join(h.storageDir, filename)

	dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save uploaded file")
		return
	}

	n, copyErr := io.Copy(dst, io.LimitReader(file, maxProofUploadBytes+1))
	closeErr := dst.Close()
	if copyErr != nil || closeErr != nil || n > maxProofUploadBytes {
		_ = os.Remove(dstPath)
		if n > maxProofUploadBytes {
			writeError(w, http.StatusBadRequest, "file exceeds 5MB limit")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to write uploaded file")
		return
	}

	proofURL := "/v1/uploads/" + filename
	if err := h.svc.SubmitManualProof(r.Context(), orderID, proofURL); err != nil {
		_ = os.Remove(dstPath)
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":         "pending_verification",
		"proof_file_url": proofURL,
	})
}

func (h *Handler) handleServeUpload(w http.ResponseWriter, r *http.Request) {
	rawName := r.PathValue("filename")
	safeName := filepath.Base(rawName)
	if safeName == "" || safeName == "." || safeName == ".." || safeName != rawName {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	filePath := filepath.Join(h.storageDir, safeName)
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	http.ServeFile(w, r, filePath)
}
