package ticketing

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/skip2/go-qrcode"
)

// TicketPDFData holds the data needed to render a printable ticket PDF.
type TicketPDFData struct {
	TicketCode     string    `json:"ticket_code"`
	EventTitle     string    `json:"event_title"`
	EventType      string    `json:"event_type"`
	Venue          string    `json:"venue"`
	StartAt        time.Time `json:"start_at"`
	EndAt          time.Time `json:"end_at"`
	AttendeeName   string    `json:"attendee_name"`
	AttendeeEmail  string    `json:"attendee_email"`
	TicketTypeName string    `json:"ticket_type_name"`
	Price          float64   `json:"price"`
	Currency       string    `json:"currency"`
}

// GenerateQRPNG generates a 256x256 PNG image of a signed QR payload.
func GenerateQRPNG(payload string) ([]byte, error) {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return nil, errors.New("empty qr payload")
	}
	return qrcode.Encode(payload, qrcode.Medium, 256)
}

// GenerateTicketPDF generates a printable PDF for a ticket with embedded QR code.
func GenerateTicketPDF(t TicketPDFData, qrPNG []byte) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(20, 20, 20)
	pdf.AddPage()

	// Title / Header
	pdf.SetFont("Arial", "B", 20)
	pdf.SetTextColor(30, 41, 59) // slate-800
	pdf.CellFormat(0, 10, "BEO EVENT TICKET", "", 1, "C", false, 0, "")

	pdf.SetFont("Arial", "", 10)
	pdf.SetTextColor(100, 116, 139) // slate-500
	pdf.CellFormat(0, 6, "Official Entry Pass • Beo Event Organizer", "", 1, "C", false, 0, "")
	pdf.Ln(6)

	// Divider
	pdf.SetDrawColor(226, 232, 240) // slate-200
	pdf.SetLineWidth(0.5)
	pdf.Line(20, pdf.GetY(), 190, pdf.GetY())
	pdf.Ln(8)

	// Event Section
	pdf.SetFont("Arial", "B", 16)
	pdf.SetTextColor(15, 23, 42) // slate-900
	eventTitle := t.EventTitle
	if eventTitle == "" {
		eventTitle = "Event Pass"
	}
	pdf.MultiCell(110, 8, eventTitle, "", "L", false)
	pdf.Ln(2)

	pdf.SetFont("Arial", "B", 9)
	pdf.SetTextColor(79, 70, 229) // indigo-600
	category := strings.ToUpper(strings.ReplaceAll(t.EventType, "_", " "))
	if category != "" {
		pdf.CellFormat(0, 6, "["+category+"]", "", 1, "L", false, 0, "")
	}
	pdf.Ln(4)

	// Info block on the left
	yBeforeDetails := pdf.GetY()

	renderField := func(label, value string) {
		pdf.SetFont("Arial", "", 9)
		pdf.SetTextColor(100, 116, 139)
		pdf.CellFormat(110, 4, strings.ToUpper(label), "", 1, "L", false, 0, "")
		pdf.SetFont("Arial", "B", 11)
		pdf.SetTextColor(30, 41, 59)
		if value == "" {
			value = "-"
		}
		pdf.CellFormat(110, 6, value, "", 1, "L", false, 0, "")
		pdf.Ln(2)
	}

	renderField("Attendee", t.AttendeeName)
	renderField("Email", t.AttendeeEmail)
	renderField("Ticket Tier", t.TicketTypeName)

	timeStr := "-"
	if !t.StartAt.IsZero() {
		timeStr = t.StartAt.Format("02 Jan 2006 15:04 MST")
		if !t.EndAt.IsZero() {
			timeStr += " - " + t.EndAt.Format("15:04 MST")
		}
	}
	renderField("Date & Time", timeStr)
	renderField("Venue", t.Venue)

	priceStr := "FREE"
	if t.Price > 0 {
		curr := t.Currency
		if curr == "" {
			curr = "IDR"
		}
		priceStr = fmt.Sprintf("%.0f %s", t.Price, curr)
	}
	renderField("Price", priceStr)

	// Embed QR Code on the right side if provided
	if len(qrPNG) > 0 {
		imgName := "qr_" + t.TicketCode
		if imgName == "qr_" {
			imgName = "qr_default"
		}
		pdf.RegisterImageOptionsReader(imgName, fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(qrPNG))
		qrX := 135.0
		qrY := yBeforeDetails
		qrSize := 55.0
		pdf.ImageOptions(imgName, qrX, qrY, qrSize, qrSize, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")

		// Ticket Code below QR
		pdf.SetXY(qrX, qrY+qrSize+2)
		pdf.SetFont("Courier", "B", 11)
		pdf.SetTextColor(15, 23, 42)
		pdf.CellFormat(qrSize, 6, t.TicketCode, "", 1, "C", false, 0, "")

		pdf.SetXY(qrX, qrY+qrSize+8)
		pdf.SetFont("Arial", "I", 7)
		pdf.SetTextColor(100, 116, 139)
		pdf.CellFormat(qrSize, 4, "Atomic Check-in QR", "", 1, "C", false, 0, "")
	}

	// Move cursor below the details block
	pdf.SetY(yBeforeDetails + 80)
	pdf.Ln(6)

	// Bottom Divider
	pdf.SetDrawColor(226, 232, 240)
	pdf.Line(20, pdf.GetY(), 190, pdf.GetY())
	pdf.Ln(4)

	// Footer Instructions
	pdf.SetFont("Arial", "I", 8)
	pdf.SetTextColor(148, 163, 184)
	pdf.MultiCell(0, 4, "Please present this ticket and valid ID at the registration desk. Each QR code is uniquely signed and can only be scanned once for entry.", "", "C", false)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("generate ticket pdf: %w", err)
	}

	return buf.Bytes(), nil
}
