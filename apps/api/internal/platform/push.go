package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// PushNotifier defines the interface for dispatching push notifications to mobile devices.
type PushNotifier interface {
	Send(ctx context.Context, tokens []string, title, body string, data map[string]string) error
}

// ExpoPushMessage represents a single message in the Expo Push API payload.
type ExpoPushMessage struct {
	To    string            `json:"to"`
	Title string            `json:"title,omitempty"`
	Body  string            `json:"body,omitempty"`
	Data  map[string]string `json:"data,omitempty"`
	Sound string            `json:"sound,omitempty"`
}

// ExpoPushNotifier implements PushNotifier by delivering messages via Expo's Push API.
type ExpoPushNotifier struct {
	client   *http.Client
	endpoint string
}

// NewExpoPushNotifier creates a new ExpoPushNotifier with an optional custom http.Client.
func NewExpoPushNotifier(client *http.Client) *ExpoPushNotifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &ExpoPushNotifier{
		client:   client,
		endpoint: "https://exp.host/--/api/v2/push/send",
	}
}

// WithEndpoint overrides the push endpoint, primarily for testing.
func (n *ExpoPushNotifier) WithEndpoint(endpoint string) *ExpoPushNotifier {
	n.endpoint = endpoint
	return n
}

// Send sends push notifications to the provided Expo push tokens in batches of up to 100.
func (n *ExpoPushNotifier) Send(ctx context.Context, tokens []string, title, body string, data map[string]string) error {
	var validTokens []string
	seen := make(map[string]bool)
	for _, tok := range tokens {
		tok = strings.TrimSpace(tok)
		if tok != "" && !seen[tok] {
			seen[tok] = true
			validTokens = append(validTokens, tok)
		}
	}

	if len(validTokens) == 0 {
		return nil
	}

	const chunkSize = 100
	for i := 0; i < len(validTokens); i += chunkSize {
		end := i + chunkSize
		if end > len(validTokens) {
			end = len(validTokens)
		}
		chunk := validTokens[i:end]

		messages := make([]ExpoPushMessage, len(chunk))
		for j, token := range chunk {
			messages[j] = ExpoPushMessage{
				To:    token,
				Title: title,
				Body:  body,
				Data:  data,
				Sound: "default",
			}
		}

		payload, err := json.Marshal(messages)
		if err != nil {
			return fmt.Errorf("marshal push messages: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.endpoint, bytes.NewReader(payload))
		if err != nil {
			return fmt.Errorf("create push request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")

		resp, err := n.client.Do(req)
		if err != nil {
			return fmt.Errorf("dispatch expo push request: %w", err)
		}

		respBody, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("expo push returned status %d: %s", resp.StatusCode, string(respBody))
		}
	}

	return nil
}
