package ticketing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

var ErrInvalidQR = errors.New("invalid or tampered QR payload")

// SignQR generates an HMAC-SHA256 signed QR payload in the format:
// ticketCode|eventID|hmacHex.
func SignQR(secret, ticketCode, eventID string) string {
	data := ticketCode + "|" + eventID
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	sig := hex.EncodeToString(mac.Sum(nil))
	return data + "|" + sig
}

// VerifyQR validates a signed QR payload and returns the embedded ticketCode and eventID.
func VerifyQR(secret, payload string) (ticketCode, eventID string, err error) {
	parts := strings.Split(payload, "|")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", ErrInvalidQR
	}

	gotSig, err := hex.DecodeString(parts[2])
	if err != nil {
		return "", "", ErrInvalidQR
	}

	data := parts[0] + "|" + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	expectedSig := mac.Sum(nil)

	if !hmac.Equal(gotSig, expectedSig) {
		return "", "", ErrInvalidQR
	}

	return parts[0], parts[1], nil
}
