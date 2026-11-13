package identity

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userContextKey contextKey = "identity.user_claims"

// Claims represents the standard and custom JWT claims for authenticated users.
type Claims struct {
	UserID      string `json:"uid"`
	Email       string `json:"email"`
	AccountType string `json:"account_type"`
	jwt.RegisteredClaims
}

// GenerateJWT creates a signed HS256 JWT for the given user.
func GenerateJWT(user User, secret string) (string, error) {
	if strings.TrimSpace(secret) == "" {
		return "", ErrEmptyJWTSecret
	}
	now := time.Now()
	claims := Claims{
		UserID:      user.ID,
		Email:       user.Email,
		AccountType: user.AccountType,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseJWT validates and parses a signed JWT string into Claims.
func ParseJWT(tokenStr, secret string) (*Claims, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, ErrEmptyJWTSecret
	}
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrUnauthorized
	}

	return claims, nil
}

// ContextWithUser returns a new Context that stores the given Claims.
func ContextWithUser(ctx context.Context, claims Claims) context.Context {
	return context.WithValue(ctx, userContextKey, claims)
}

// UserFromContext extracts Claims from the context if present.
func UserFromContext(ctx context.Context) (Claims, bool) {
	claims, ok := ctx.Value(userContextKey).(Claims)
	return claims, ok
}

// AuthMiddleware extracts the Bearer token from the Authorization header,
// validates it using the provided secret, and injects the claims into the request context.
func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("identity: jwtSecret cannot be empty")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"unauthorized: missing authorization header"}`))
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"unauthorized: invalid authorization format"}`))
				return
			}

			claims, err := ParseJWT(parts[1], jwtSecret)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"unauthorized: invalid token"}`))
				return
			}

			ctx := ContextWithUser(r.Context(), *claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
