import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast as sonnerToast } from "sonner";
import { toastConfirmed, toastError, toastWarning } from "./toast";

describe("toast foundation", () => {
  it("toastWarning delegates to sonner's warning variant", () => {
    toastWarning("I can't read this file yet.");
    expect(sonnerToast.warning).toHaveBeenCalledWith("I can't read this file yet.");
  });

  it("toastError delegates to sonner's error variant", () => {
    toastError("This file is too large. Maximum size is 10MB.");
    expect(sonnerToast.error).toHaveBeenCalledWith("This file is too large. Maximum size is 10MB.");
  });

  it("toastConfirmed with undoable=true and onUndo attaches an Undo action", () => {
    const onUndo = vi.fn();
    toastConfirmed("₹500 added to Dining from HDFC Bank.", { undoable: true, onUndo });
    expect(sonnerToast.success).toHaveBeenCalledWith(
      "₹500 added to Dining from HDFC Bank.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo", onClick: onUndo }),
      }),
    );
  });

  it("toastConfirmed with undoable=false never attaches an Undo action (api-architecture.md §11)", () => {
    toastConfirmed("45 transactions imported.", { undoable: false });
    expect(sonnerToast.success).toHaveBeenCalledWith(
      "45 transactions imported.",
      expect.objectContaining({ action: undefined }),
    );
  });

  it("toastConfirmed with no options at all never attaches an Undo action", () => {
    toastConfirmed("Profile updated.");
    expect(sonnerToast.success).toHaveBeenCalledWith(
      "Profile updated.",
      expect.objectContaining({ action: undefined }),
    );
  });
});
