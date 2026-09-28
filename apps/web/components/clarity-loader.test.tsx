import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

// next/script's real implementation dedupes DOM insertion by `id` across
// the whole module (a real script tag can only usefully exist once per
// page), which makes asserting on the actual injected DOM node unreliable
// across multiple tests in one file. Mocked here so each test asserts on
// what this component actually decides -- render Script or don't --
// rather than on next/script's own cross-render caching behavior.
vi.mock("next/script", () => ({
  default: (props: { id: string; children: string }) => <script data-testid={props.id} data-mocked-script="" dangerouslySetInnerHTML={{ __html: props.children }} />,
}));

const { ClarityLoader } = await import("./clarity-loader");

describe("<ClarityLoader>", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not initialize Clarity while Privacy Mode is enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) }),
    );
    const { container } = render(<ClarityLoader projectId="test-project" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/privacy-mode"));
    expect(container.querySelector("[data-mocked-script]")).toBeNull();
  });

  it("initializes Clarity when Privacy Mode is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) }),
    );
    const { container } = render(<ClarityLoader projectId="test-project" />);
    await waitFor(() => expect(container.querySelector("[data-mocked-script]")).not.toBeNull());
  });

  it("fails open to loading Clarity if the privacy-mode check itself fails, rather than guessing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { container } = render(<ClarityLoader projectId="test-project" />);
    await waitFor(() => expect(container.querySelector("[data-mocked-script]")).not.toBeNull());
  });
});
