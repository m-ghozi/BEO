package platform_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

func TestExpoPushNotifier_Send(t *testing.T) {
	var receivedMessages []platform.ExpoPushMessage

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("failed to read body: %v", err)
		}

		var msgs []platform.ExpoPushMessage
		if err := json.Unmarshal(body, &msgs); err != nil {
			t.Fatalf("failed to unmarshal push messages: %v", err)
		}
		receivedMessages = append(receivedMessages, msgs...)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[{"status":"ok"}]}`))
	}))
	defer server.Close()

	notifier := platform.NewExpoPushNotifier(server.Client()).WithEndpoint(server.URL)

	ctx := context.Background()
	tokens := []string{"ExponentPushToken[t1]", "ExponentPushToken[t2]", "ExponentPushToken[t1]"} // duplicate t1
	title := "Announcement Title"
	body := "Body message"
	data := map[string]string{"event_id": "evt-123"}

	err := notifier.Send(ctx, tokens, title, body, data)
	if err != nil {
		t.Fatalf("expected Send to succeed, got: %v", err)
	}

	if len(receivedMessages) != 2 {
		t.Fatalf("expected 2 unique messages sent, got %d", len(receivedMessages))
	}
	if receivedMessages[0].Title != title || receivedMessages[0].Body != body {
		t.Errorf("unexpected message content: %+v", receivedMessages[0])
	}
	if receivedMessages[0].Data["event_id"] != "evt-123" {
		t.Errorf("unexpected message data: %+v", receivedMessages[0].Data)
	}

	// Test empty tokens does not trigger request
	receivedMessages = nil
	err = notifier.Send(ctx, []string{}, title, body, data)
	if err != nil {
		t.Fatalf("expected empty tokens to succeed with no-op, got: %v", err)
	}
	if len(receivedMessages) != 0 {
		t.Errorf("expected 0 messages sent, got %d", len(receivedMessages))
	}
}

func TestExpoPushNotifier_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal expo failure"}`))
	}))
	defer server.Close()

	notifier := platform.NewExpoPushNotifier(server.Client()).WithEndpoint(server.URL)
	err := notifier.Send(context.Background(), []string{"ExponentPushToken[t1]"}, "Title", "Body", nil)
	if err == nil {
		t.Fatalf("expected Send to fail on 500 status, got nil")
	}
}
