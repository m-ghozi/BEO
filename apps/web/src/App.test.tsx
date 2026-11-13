import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders BEO title", () => {
    render(<App />);
    expect(
      screen.getByText(/BEO — Universal Event Organizer/i)
    ).toBeInTheDocument();
  });
});
