package ticketing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ReleaseExpiredOrders finds orders with expires_at < NOW() and payment_status = 'pending',
// marks them expired, releases reserved ticket counts from ticket_types, and marks tickets as
// cancelled, all inside a single transaction. Orders in 'pending_verification' are not expired
// automatically because payment proof has been submitted and awaits organizer review.
// Returns the number of released expired orders.
func ReleaseExpiredOrders(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	if pool == nil {
		return 0, errors.New("db pool is required")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin release expired tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Lock expired orders with SKIP LOCKED to allow concurrent workers without blocking/deadlock
	rows, err := tx.Query(ctx, `
		SELECT id
		FROM orders
		WHERE expires_at < NOW()
		  AND payment_status = 'pending'
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return 0, fmt.Errorf("select expired orders: %w", err)
	}
	defer rows.Close()

	var expiredOrderIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("scan expired order id: %w", err)
		}
		expiredOrderIDs = append(expiredOrderIDs, id)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate expired orders: %w", err)
	}
	rows.Close()

	if len(expiredOrderIDs) == 0 {
		return 0, nil
	}

	// 2. Lock tickets for the expired orders and aggregate count per ticket_type_id
	ticketRows, err := tx.Query(ctx, `
		SELECT ticket_type_id
		FROM tickets
		WHERE order_id = ANY($1) AND status != 'cancelled'
		FOR UPDATE
	`, expiredOrderIDs)
	if err != nil {
		return 0, fmt.Errorf("query tickets to decrement: %w", err)
	}
	defer ticketRows.Close()

	counts := make(map[string]int)
	for ticketRows.Next() {
		var ttID string
		if err := ticketRows.Scan(&ttID); err != nil {
			return 0, fmt.Errorf("scan ticket type id: %w", err)
		}
		counts[ttID]++
	}
	if err := ticketRows.Err(); err != nil {
		return 0, fmt.Errorf("iterate tickets: %w", err)
	}
	ticketRows.Close()

	// Decrement reserved_count for each ticket type
	for ttID, qty := range counts {
		if _, err := tx.Exec(ctx, `
			UPDATE ticket_types
			SET reserved_count = GREATEST(0, reserved_count - $1)
			WHERE id = $2
		`, qty, ttID); err != nil {
			return 0, fmt.Errorf("decrement reserved count for %s: %w", ttID, err)
		}
	}

	// 3. Update tickets for that order to status = 'cancelled'
	if _, err := tx.Exec(ctx, `
		UPDATE tickets
		SET status = 'cancelled'
		WHERE order_id = ANY($1)
	`, expiredOrderIDs); err != nil {
		return 0, fmt.Errorf("cancel tickets for expired orders: %w", err)
	}

	// 4. Update order payment_status = 'expired'
	if _, err := tx.Exec(ctx, `
		UPDATE orders
		SET payment_status = 'expired', updated_at = NOW()
		WHERE id = ANY($1)
	`, expiredOrderIDs); err != nil {
		return 0, fmt.Errorf("update expired orders status: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit release expired tx: %w", err)
	}

	return len(expiredOrderIDs), nil
}

// StartOrderExpiryWorker runs ReleaseExpiredOrders periodically in the background
// until the context is cancelled.
func StartOrderExpiryWorker(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	if interval <= 0 {
		interval = 1 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = ReleaseExpiredOrders(ctx, pool)
		}
	}
}
