import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { OrderReturnPage } from "./OrderReturnPage";

describe("OrderReturnPage", () => {
  it("renders success feedback when resultCode=00", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/orders/return?merchantOrderId=ord-123&resultCode=00&reference=DUITKU-REF-99",
        ]}
      >
        <Routes>
          <Route path="/orders/return" element={<OrderReturnPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Payment Successful/i)).toBeInTheDocument();
    expect(screen.getByText("ord-123")).toBeInTheDocument();
    expect(screen.getByText("DUITKU-REF-99")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Go to My Tickets/i })
    ).toHaveAttribute("href", "/my-tickets");
    expect(
      screen.getByRole("link", { name: /Back to Events/i })
    ).toHaveAttribute("href", "/");
  });

  it("renders pending/failed feedback when resultCode is not 00", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/orders/return?merchantOrderId=ord-456&resultCode=01&reference=DUITKU-REF-00",
        ]}
      >
        <Routes>
          <Route path="/orders/return" element={<OrderReturnPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByText(/Payment Pending or Failed/i)
    ).toBeInTheDocument();
    expect(screen.getByText("ord-456")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Go to My Tickets/i })
    ).toHaveAttribute("href", "/my-tickets");
  });
});
