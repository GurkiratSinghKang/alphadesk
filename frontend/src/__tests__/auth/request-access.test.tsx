import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RequestAccessForm from "@/app/request-access/_request/RequestAccessForm";

describe("RequestAccessForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits a durable access request and renders the reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, request_id: "AR-K7Q3M9V2T1BC", status: "received" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mira Patel" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "mira@fund.example" } });
    fireEvent.change(screen.getByLabelText("Trading jurisdiction"), { target: { value: "United States" } });
    fireEvent.change(screen.getByLabelText("Book context"), {
      target: {
        value: "I run a paper-to-live US equities and listed options workflow with strict risk controls.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/access-requests",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.email).toBe("mira@fund.example");
    expect(body.instruments).toEqual(["us_equities", "listed_options"]);

    expect(await screen.findByText(/AR-K7Q3M9V2T1BC/)).toBeInTheDocument();
  });

  it("surfaces API validation errors inline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Too many access requests from this network. Please try again later." }),
      }),
    );

    render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ilan Mercer" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ilan@desk.example" } });
    fireEvent.change(screen.getByLabelText("Trading jurisdiction"), { target: { value: "Canada" } });
    fireEvent.change(screen.getByLabelText("Book context"), {
      target: {
        value: "Looking for a controlled systematic trading desk with paper-first onboarding.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many access requests");
  });
});
