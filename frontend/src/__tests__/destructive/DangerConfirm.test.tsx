import "../setup-mocks";

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import DangerConfirm from "@/components/destructive/DangerConfirm";

describe("DangerConfirm", () => {
  it("disables the confirm button until typed === confirmWord AND reason is long enough", () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        open
        onOpenChange={() => {}}
        title="Halt trading on NVDA"
        body="This stops new orders for NVDA."
        confirmWord="HALT-NVDA"
        onConfirm={onConfirm}
      />,
    );

    const submit = screen.getByRole("button", { name: /confirm/i });
    expect(submit).toBeDisabled();

    // Reason long enough but typed wrong → still disabled.
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "earnings risk" },
    });
    fireEvent.change(screen.getByLabelText(/Type.*to enable/i), {
      target: { value: "halt-nvda" }, // case-sensitive
    });
    expect(submit).toBeDisabled();

    // Correct typed-confirm → enabled.
    fireEvent.change(screen.getByLabelText(/Type.*to enable/i), {
      target: { value: "HALT-NVDA" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("calls onConfirm with the typed reason", async () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        open
        onOpenChange={() => {}}
        title="Rotate Anthropic key"
        body="This invalidates the previous key."
        confirmWord="ROTATE"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "quarterly rotation" },
    });
    fireEvent.change(screen.getByLabelText(/Type.*to enable/i), {
      target: { value: "ROTATE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledWith({ reason: "quarterly rotation" });
  });

  it("supports skipping the reason field via reasonRequired={false}", () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        open
        onOpenChange={() => {}}
        title="Resume trading"
        body="Resume order flow."
        confirmWord="RESUME"
        reasonRequired={false}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByLabelText(/Reason/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Type.*to enable/i), {
      target: { value: "RESUME" },
    });
    expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
  });

  it("renders diff preview + audit preview when supplied", () => {
    render(
      <DangerConfirm
        open
        onOpenChange={() => {}}
        title="Halt"
        body="halt"
        onConfirm={() => {}}
        diffPreview={<div data-testid="diff">halted: false → true</div>}
        auditPreview={<div data-testid="audit">halt_toggled by operator</div>}
      />,
    );
    expect(screen.getByTestId("diff")).not.toBeNull();
    expect(screen.getByTestId("audit")).not.toBeNull();
  });

  it("Cancel button closes via onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <DangerConfirm
        open
        onOpenChange={onOpenChange}
        title="Halt"
        body="halt"
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
