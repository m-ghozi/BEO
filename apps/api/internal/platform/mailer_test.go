package platform_test

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

// mockSMTPServer starts an in-memory SMTP server on a random local port
// and records the delivered email message.
type mockSMTPServer struct {
	listener net.Listener
	received chan string
	errs     chan error
}

func startMockSMTPServer(t *testing.T) *mockSMTPServer {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen on local port: %v", err)
	}

	s := &mockSMTPServer{
		listener: l,
		received: make(chan string, 1),
		errs:     make(chan error, 1),
	}

	go func() {
		conn, err := l.Accept()
		if err != nil {
			s.errs <- err
			return
		}
		defer conn.Close()

		reader := bufio.NewReader(conn)
		writer := bufio.NewWriter(conn)

		// Greeting
		writer.WriteString("220 mock.smtp.local Service ready\r\n")
		writer.Flush()

		var dataBuf bytes.Buffer
		inData := false

		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				if err != io.EOF {
					s.errs <- err
				}
				break
			}

			if inData {
				if line == ".\r\n" {
					inData = false
					writer.WriteString("250 OK: message queued\r\n")
					writer.Flush()
					s.received <- dataBuf.String()
				} else {
					dataBuf.WriteString(line)
				}
				continue
			}

			upper := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(upper, "EHLO") || strings.HasPrefix(upper, "HELO"):
				writer.WriteString("250-mock.smtp.local\r\n250 HELP\r\n")
				writer.Flush()
			case strings.HasPrefix(upper, "MAIL FROM:"):
				writer.WriteString("250 2.1.0 Sender OK\r\n")
				writer.Flush()
			case strings.HasPrefix(upper, "RCPT TO:"):
				writer.WriteString("250 2.1.5 Recipient OK\r\n")
				writer.Flush()
			case upper == "DATA":
				inData = true
				writer.WriteString("354 Start mail input; end with <CRLF>.<CRLF>\r\n")
				writer.Flush()
			case upper == "QUIT":
				writer.WriteString("221 2.0.0 Service closing transmission channel\r\n")
				writer.Flush()
				return
			default:
				writer.WriteString("502 Command not implemented\r\n")
				writer.Flush()
			}
		}
	}()

	return s
}

func (s *mockSMTPServer) Close() {
	_ = s.listener.Close()
}

func (s *mockSMTPServer) Addr() string {
	return s.listener.Addr().String()
}

func TestSMTPMailer_SendTicketEmail(t *testing.T) {
	mockServer := startMockSMTPServer(t)
	defer mockServer.Close()

	host, port, err := net.SplitHostPort(mockServer.Addr())
	if err != nil {
		t.Fatalf("failed to split host port: %v", err)
	}

	mailer := platform.NewSMTPMailer(host, port, "", "", "tickets@cerdas.club")

	// 1. Validate empty email/subject rejected
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := mailer.SendTicketEmail(ctx, "", "Subject", "<p>Hello</p>", nil, nil); err == nil {
		t.Error("expected error for empty recipient email, got nil")
	}
	if err := mailer.SendTicketEmail(ctx, "attendee@example.com", "", "<p>Hello</p>", nil, nil); err == nil {
		t.Error("expected error for empty subject, got nil")
	}

	// 2. Send email with simulated QR PNG and PDF attachment
	dummyQR := []byte("\x89PNG\r\n\x1a\nfake-qr-data")
	dummyPDF := []byte("%PDF-1.4\nfake-pdf-data\n%%EOF")

	err = mailer.SendTicketEmail(ctx, "attendee@example.com", "Your BEO Ticket", "<h1>Enjoy your event!</h1>", dummyPDF, dummyQR)
	if err != nil {
		t.Fatalf("SendTicketEmail failed: %v", err)
	}

	select {
	case received := <-mockServer.received:
		if !strings.Contains(received, "From: tickets@cerdas.club") {
			t.Errorf("expected From header in received mail, got: %s", received)
		}
		if !strings.Contains(received, "To: attendee@example.com") {
			t.Errorf("expected To header in received mail, got: %s", received)
		}
		if !strings.Contains(received, "Subject: Your BEO Ticket") {
			t.Errorf("expected Subject header in received mail, got: %s", received)
		}
		if !strings.Contains(received, "Enjoy your event!") {
			t.Errorf("expected HTML body in received mail")
		}
		if !strings.Contains(received, "Content-Id: <qrcode>") && !strings.Contains(received, "Content-ID: <qrcode>") {
			t.Errorf("expected Content-Id for QR image in received mail, got: %s", received)
		}
		if !strings.Contains(received, "filename=\"ticket.pdf\"") {
			t.Errorf("expected filename for PDF in received mail")
		}
	case err := <-mockServer.errs:
		t.Fatalf("server error: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for mock SMTP server to receive email")
	}
}

func TestSMTPMailer_NewFromConfig(t *testing.T) {
	cfg := platform.Config{
		SMTPHost: "smtp-relay.brevo.com",
		SMTPPort: "587",
		SMTPUser: "brevo-user",
		SMTPPass: "brevo-secret-pass",
		SMTPFrom: "no-reply@cerdas.club",
	}

	mailer := platform.NewSMTPMailerFromConfig(cfg)
	if mailer == nil {
		t.Fatal("expected non-nil SMTPMailer from config")
	}
}

func TestSMTPMailer_RejectsHeaderInjection(t *testing.T) {
	mailer := platform.NewSMTPMailer("localhost", "1025", "", "", "tickets@cerdas.club")
	ctx := context.Background()

	maliciousEmails := []string{
		"victim@example.com\r\nBcc: hacker@example.com",
		"victim@example.com\nBcc: hacker@example.com",
		"victim@example.com\rBcc: hacker@example.com",
	}
	for _, email := range maliciousEmails {
		if err := mailer.SendTicketEmail(ctx, email, "Safe Subject", "<p>hi</p>", nil, nil); !errors.Is(err, platform.ErrHeaderInjectionDetected) {
			t.Errorf("expected ErrHeaderInjectionDetected for email %q, got: %v", email, err)
		}
	}

	maliciousSubjects := []string{
		"Safe Subject\r\nBcc: attacker@example.com",
		"Safe Subject\nBcc: attacker@example.com",
		"Safe Subject\rBcc: attacker@example.com",
	}
	for _, subject := range maliciousSubjects {
		if err := mailer.SendTicketEmail(ctx, "attendee@example.com", subject, "<p>hi</p>", nil, nil); !errors.Is(err, platform.ErrHeaderInjectionDetected) {
			t.Errorf("expected ErrHeaderInjectionDetected for subject %q, got: %v", subject, err)
		}
	}
}
