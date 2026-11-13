package payments

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DuitkuCreateInvoiceRequest represents the payload sent to Duitku's invoice creation API.
type DuitkuCreateInvoiceRequest struct {
	MerchantCode    string `json:"merchantCode"`
	PaymentAmount   int64  `json:"paymentAmount"`
	MerchantOrderID string `json:"merchantOrderId"`
	ProductDetails  string `json:"productDetails"`
	Email           string `json:"email"`
	CallbackURL     string `json:"callbackUrl"`
	ReturnURL       string `json:"returnUrl"`
	Signature       string `json:"signature"`
}

// DuitkuCreateInvoiceResponse represents the response returned by Duitku's invoice creation API.
type DuitkuCreateInvoiceResponse struct {
	PaymentURL    string `json:"paymentUrl"`
	Reference     string `json:"reference"`
	StatusCode    string `json:"statusCode"`
	StatusMessage string `json:"statusMessage"`
}

// DuitkuCallback represents the webhook notification payload sent by Duitku.
type DuitkuCallback struct {
	MerchantCode    string `json:"merchantCode"`
	Amount          string `json:"amount"`
	MerchantOrderID string `json:"merchantOrderId"`
	ProductDetail   string `json:"productDetail"`
	AdditionalParam string `json:"additionalParam"`
	PaymentCode     string `json:"paymentCode"`
	ResultCode      string `json:"resultCode"`
	MerchantUserID  string `json:"merchantUserId"`
	Reference       string `json:"reference"`
	Signature       string `json:"signature"`
}

// DuitkuClient abstracts Duitku invoice creation for production HTTP calls and test stubs.
type DuitkuClient interface {
	CreateInvoice(ctx context.Context, req DuitkuCreateInvoiceRequest) (DuitkuCreateInvoiceResponse, error)
}

// HTTPDuitkuClient implements DuitkuClient over HTTP against Duitku's Web API.
type HTTPDuitkuClient struct {
	merchantCode string
	apiKey       string
	baseURL      string
	httpClient   *http.Client
}

// NewHTTPDuitkuClient creates a new HTTPDuitkuClient.
func NewHTTPDuitkuClient(merchantCode, apiKey, baseURL string, httpClient *http.Client) *HTTPDuitkuClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &HTTPDuitkuClient{
		merchantCode: strings.TrimSpace(merchantCode),
		apiKey:       strings.TrimSpace(apiKey),
		baseURL:      strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient:   httpClient,
	}
}

// ComputeDuitkuInquirySignature computes MD5(merchantCode + merchantOrderId + paymentAmount + apiKey).
func ComputeDuitkuInquirySignature(merchantCode, merchantOrderID string, paymentAmount int64, apiKey string) string {
	raw := merchantCode + merchantOrderID + strconv.FormatInt(paymentAmount, 10) + apiKey
	sum := md5.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// VerifyDuitkuCallbackSignature verifies MD5(merchantCode + amount + merchantOrderId + apiKey) in constant time.
func VerifyDuitkuCallbackSignature(merchantCode, amount, merchantOrderID, apiKey, signature string) bool {
	raw := merchantCode + amount + merchantOrderID + apiKey
	sum := md5.Sum([]byte(raw))
	expected := hex.EncodeToString(sum[:])
	got := strings.ToLower(strings.TrimSpace(signature))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(got)) == 1
}

// CreateInvoice calls Duitku's v2 inquiry endpoint to create a payment invoice and return a payment URL.
func (c *HTTPDuitkuClient) CreateInvoice(ctx context.Context, req DuitkuCreateInvoiceRequest) (DuitkuCreateInvoiceResponse, error) {
	if c.baseURL == "" {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("duitku base URL is empty")
	}
	if req.MerchantCode == "" {
		req.MerchantCode = c.merchantCode
	}
	if req.Signature == "" {
		req.Signature = ComputeDuitkuInquirySignature(req.MerchantCode, req.MerchantOrderID, req.PaymentAmount, c.apiKey)
	}

	body, err := json.Marshal(req)
	if err != nil {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("marshal duitku request: %w", err)
	}

	endpoint := c.baseURL + "/api/merchant/v2/inquiry"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("create duitku http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("execute duitku request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("read duitku response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("duitku API returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	var out DuitkuCreateInvoiceResponse
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return DuitkuCreateInvoiceResponse{}, fmt.Errorf("decode duitku response: %w", err)
	}
	if out.StatusCode != "" && out.StatusCode != "00" {
		return out, fmt.Errorf("duitku error %s: %s", out.StatusCode, out.StatusMessage)
	}

	return out, nil
}
