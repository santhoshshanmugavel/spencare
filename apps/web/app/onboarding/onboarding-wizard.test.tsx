import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { OnboardingWizard, type OnboardingInitialValues } from "./onboarding-wizard";

vi.mock("./actions", () => ({
  saveOnboardingStepAction: vi.fn(async () => ({ ok: true, value: {} })),
  completeOnboardingAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

vi.mock("../(auth)/actions", () => ({
  signOutAction: vi.fn(async () => {}),
}));

const emptyInitial: OnboardingInitialValues = {
  displayName: "",
  preferredCurrency: "INR",
  incomeAmountMinor: null,
  incomeFrequency: null,
  interestedCategories: [],
  interestedGoalTypes: [],
};

describe("<OnboardingWizard> — step 1 (About you)", () => {
  it("has no axe violations", async () => {
    const { container } = render(<OnboardingWizard initial={emptyInitial} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the correct step label and progress", () => {
    render(<OnboardingWizard initial={emptyInitial} />);
    expect(screen.getByText("Step 1 of 4: About you")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("pre-fills from initial values (refresh-safe resumption)", () => {
    render(
      <OnboardingWizard
        initial={{ ...emptyInitial, displayName: "Santhosh", preferredCurrency: "USD" }}
      />,
    );
    expect(screen.getByLabelText("What should we call you?")).toHaveValue("Santhosh");
  });

  it("does not advance past step 1 without a name (client-side validation)", async () => {
    const { saveOnboardingStepAction } = await import("./actions");
    const user = userEvent.setup();
    render(<OnboardingWizard initial={emptyInitial} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter your name/i);
    expect(saveOnboardingStepAction).not.toHaveBeenCalled();
    expect(screen.getByText("Step 1 of 4: About you")).toBeInTheDocument();
  });

  it("has a working sign-out escape hatch (a user mid-onboarding is not trapped)", () => {
    render(<OnboardingWizard initial={emptyInitial} />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});

describe("<OnboardingWizard> — advancing through steps", () => {
  it("saves step 1 and advances to step 2 (Income) on Continue", async () => {
    const { saveOnboardingStepAction } = await import("./actions");
    const user = userEvent.setup();
    render(<OnboardingWizard initial={emptyInitial} />);
    await user.type(screen.getByLabelText("What should we call you?"), "Santhosh");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(saveOnboardingStepAction).toHaveBeenCalledWith({
      displayName: "Santhosh",
      preferredCurrency: "INR",
    });
    expect(await screen.findByText("Step 2 of 4: Income")).toBeInTheDocument();
  });

  it("Skip advances without saving that step's fields", async () => {
    const { saveOnboardingStepAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <OnboardingWizard initial={{ ...emptyInitial, displayName: "Santhosh" }} />,
    );
    await user.click(screen.getByRole("button", { name: "Continue" })); // step 1 -> 2
    vi.mocked(saveOnboardingStepAction).mockClear();
    await user.click(screen.getByRole("button", { name: "Skip" })); // step 2 skipped
    expect(saveOnboardingStepAction).not.toHaveBeenCalled();
    expect(await screen.findByText("Step 3 of 4: Spending")).toBeInTheDocument();
  });

  it("Back returns to the previous step without losing entered data", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard initial={{ ...emptyInitial, displayName: "Santhosh" }} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> step 2
    await user.click(screen.getByRole("button", { name: "Back" })); // -> step 1
    expect(screen.getByLabelText("What should we call you?")).toHaveValue("Santhosh");
  });

  it("category chips toggle selection with aria-pressed", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard initial={{ ...emptyInitial, displayName: "Santhosh" }} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // step 2
    await user.click(screen.getByRole("button", { name: "Skip" })); // step 3
    const chip = await screen.findByRole("button", { name: "Dining" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("the final step shows Finish, not Continue, and touch-target-sized controls", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard initial={{ ...emptyInitial, displayName: "Santhosh" }} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // step 2
    await user.click(screen.getByRole("button", { name: "Skip" })); // step 3
    await user.click(screen.getByRole("button", { name: "Skip" })); // step 4
    const finish = await screen.findByRole("button", { name: "Finish" });
    expect(finish).toHaveAttribute("data-size", "touch");
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });
});
