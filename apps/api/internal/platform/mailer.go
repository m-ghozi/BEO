package platform

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"mime/multipart"
	"net"
	"net/smtp"
	"net/textproto"
	"strings"
)

var (
	ErrInvalidEmail            = errors.New("recipient email and subject must not be empty")
	ErrHeaderInjectionDetected = errors.New("newline characters detected in email or subject (header injection risk)")
)

// Mailer defines the contract for sending transactional emails with attachments.
type Mailer interface {
	SendTicketEmail(ctx context.Context, toEmail, subject, htmlBody string, pdfBytes, qrPNG []byte) error
}

// SMTPMailer implements Mailer over standard SMTP with STARTTLS and PLAIN auth support.
// Compatible with Brevo SMTP (STARTTLS on port 587) and local Mailpit (port 1025).
type SMTPMailer struct {
	host string
	port string
	user string
	pass string
	from string
}

var _ Mailer = (*SMTPMailer)(nil)

// NewSMTPMailer creates a new SMTPMailer.
func NewSMTPMailer(host, port, user, pass, from string) *SMTPMailer {
	if strings.TrimSpace(from) == "" {
		from = "no-reply@cerdas.club"
	}
	return &SMTPMailer{
		host: strings.TrimSpace(host),
		port: strings.TrimSpace(port),
		user: strings.TrimSpace(user),
		pass: strings.TrimSpace(pass),
		from: strings.TrimSpace(from),
	}
}

// NewSMTPMailerFromConfig creates an SMTPMailer from platform Config.
func NewSMTPMailerFromConfig(cfg Config) *SMTPMailer {
	return NewSMTPMailer(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPFrom)
}

// buildTicketEmailMessage constructs a MIME multipart/mixed message containing
// HTML body, embedded inline QR code image, and PDF ticket attachment.
func buildTicketEmailMessage(from, to, subject, htmlBody string, pdfBytes, qrPNG []byte) ([]byte, error) {
	var buf bytes.Buffer

	// Top-level headers
	buf.WriteString(fmt.Sprintf("From: %s\r\n", from))
	buf.WriteString(fmt.Sprintf("To: %s\r\n", to))
	buf.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	buf.WriteString("MIME-Version: 1.0\r\n")

	writer := multipart.NewWriter(&buf)
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=%s\r\n\r\n", writer.Boundary()))

	// 1. HTML part
	htmlHeader := make(textproto.MIMEHeader)
	htmlHeader.Set("Content-Type", "text/html; charset=UTF-8")
	htmlHeader.Set("Content-Transfer-Encoding", "8bit")
	htmlPart, err := writer.CreatePart(htmlHeader)
	if err != nil {
		return nil, fmt.Errorf("create html part: %w", err)
	}
	if _, err := htmlPart.Write([]byte(htmlBody)); err != nil {
		return nil, fmt.Errorf("write html part: %w", err)
	}

	// 2. QR code PNG (inline cid:qrcode)
	if len(qrPNG) > 0 {
		qrHeader := make(textproto.MIMEHeader)
		qrHeader.Set("Content-Type", "image/png; name=\"qrcode.png\"")
		qrHeader.Set("Content-Transfer-Encoding", "base64")
		qrHeader.Set("Content-Disposition", "inline; filename=\"qrcode.png\"")
		qrHeader.Set("Content-ID", "<qrcode>")
		qrPart, err := writer.CreatePart(qrHeader)
		if err != nil {
			return nil, fmt.Errorf("create qr part: %w", err)
		}
		b64QR := base64.StdEncoding.EncodeToString(qrPNG)
		for i := 0; i < len(b64QR); i += 76 {
			end := i + 76
			if end > len(b64QR) {
				end = len(b64QR)
			}
			qrPart.Write([]byte(b64QR[i:end] + "\r\n"))
		}
	}

	// 3. PDF ticket attachment
	if len(pdfBytes) > 0 {
		pdfHeader := make(textproto.MIMEHeader)
		pdfHeader.Set("Content-Type", "application/pdf; name=\"ticket.pdf\"")
		pdfHeader.Set("Content-Transfer-Encoding", "base64")
		pdfHeader.Set("Content-Disposition", "attachment; filename=\"ticket.pdf\"")
		pdfPart, err := writer.CreatePart(pdfHeader)
		if err != nil {
			return nil, fmt.Errorf("create pdf part: %w", err)
		}
		b64PDF := base64.StdEncoding.EncodeToString(pdfBytes)
		for i := 0; i < len(b64PDF); i += 76 {
			end := i + 76
			if end > len(b64PDF) {
				end = len(b64PDF)
			}
			pdfPart.Write([]byte(b64PDF[i:end] + "\r\n"))
		}
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close multipart writer: %w", err)
	}

	return buf.Bytes(), nil
}

// SendTicketEmail sends a ticket email with optional PDF attachment and QR PNG image.
func (m *SMTPMailer) SendTicketEmail(ctx context.Context, toEmail, subject, htmlBody string, pdfBytes, qrPNG []byte) error {
	toEmail = strings.TrimSpace(toEmail)
	subject = strings.TrimSpace(subject)
	if toEmail == "" || subject == "" {
		return ErrInvalidEmail
	}
	if strings.ContainsAny(toEmail, "\r\n") || strings.ContainsAny(subject, "\r\n") {
		return ErrHeaderInjectionDetected
	}

	msg, err := buildTicketEmailMessage(m.from, toEmail, subject, htmlBody, pdfBytes, qrPNG)
	if err != nil {
		return err
	}

	host := m.host
	if host == "" {
		host = "localhost"
	}
	port := m.port
	if port == "" {
		port = "1025"
	}
	addr := net.JoinHostPort(host, port)

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp dial %s: %w", addr, err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client init: %w", err)
	}
	defer func() { _ = client.Close() }()

	if err := client.Hello("localhost"); err != nil {
		return fmt.Errorf("smtp hello: %w", err)
	}

	// STARTTLS if supported (e.g., Brevo port 587)
	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{
			ServerName:         host,
			InsecureSkipVerify: host == "localhost" || host == "127.0.0.1",
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}

	// Authenticate if credentials are provided
	if m.user != "" && m.pass != "" {
		auth := smtp.PlainAuth("", m.user, m.pass, host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	if err := client.Mail(m.from); err != nil {
		return fmt.Errorf("smtp mail from %s: %w", m.from, err)
	}
	if err := client.Rcpt(toEmail); err != nil {
		return fmt.Errorf("smtp rcpt to %s: %w", toEmail, err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}

	_ = client.Quit()
	return nil
}

