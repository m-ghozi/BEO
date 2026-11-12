package platform

import (
	"os"
)

// Config holds runtime configuration for the BEO API service.
type Config struct {
	DatabaseURL        string
	JWTSecret          string
	QRHMACSecret       string
	SMTPHost           string
	SMTPPort           string
	SMTPUser           string
	SMTPPass           string
	SMTPFrom           string
	DuitkuMerchantCode string
	DuitkuAPIKey       string
	DuitkuBaseURL      string
	StorageDir         string
}

// getEnvOrDefault returns the value of an environment variable or a fallback default.
func getEnvOrDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// LoadConfig loads configuration from environment variables with safe dev defaults.
func LoadConfig() (Config, error) {
	cfg := Config{
		DatabaseURL:        getEnvOrDefault("DATABASE_URL", "postgres://beo:beo@localhost:5432/beo?sslmode=disable"),
		JWTSecret:          getEnvOrDefault("JWT_SECRET", "beo-super-secret-jwt-key-for-dev-32b"),
		QRHMACSecret:       getEnvOrDefault("QR_HMAC_SECRET", "beo-super-secret-qr-hmac-key-32b"),
		SMTPHost:           getEnvOrDefault("SMTP_HOST", "localhost"),
		SMTPPort:           getEnvOrDefault("SMTP_PORT", "1025"),
		SMTPUser:           getEnvOrDefault("SMTP_USER", ""),
		SMTPPass:           getEnvOrDefault("SMTP_PASS", ""),
		SMTPFrom:           getEnvOrDefault("SMTP_FROM", "no-reply@cerdas.club"),
		DuitkuMerchantCode: getEnvOrDefault("DUITKU_MERCHANT_CODE", "D1234"),
		DuitkuAPIKey:       getEnvOrDefault("DUITKU_API_KEY", "test_api_key"),
		DuitkuBaseURL:      getEnvOrDefault("DUITKU_BASE_URL", "https://sandbox.duitku.com/webapi"),
		StorageDir:         getEnvOrDefault("STORAGE_DIR", "./uploads"),
	}
	return cfg, nil
}

