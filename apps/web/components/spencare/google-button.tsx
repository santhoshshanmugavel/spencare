import { Button } from "@/components/ui/button";

/**
 * "Continue with Google" -- submits a plain <form> whose action is a
 * server action bound to the current redirect target, so it works even
 * without client JS. `aria-label` gives it an accessible name distinct
 * from "Sign in" (accessibility-requirements.md §3, Phase 5 §10 "OAuth
 * button accessible name").
 */
export function GoogleButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <Button
        type="submit"
        variant="outline"
        size="touch"
        className="w-full"
        aria-label={label}
      >
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.82Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.11A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l3.99-3.11Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.61l3.99 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
          />
        </svg>
        {label}
      </Button>
    </form>
  );
}
