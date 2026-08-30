import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder ONLY (Phase 21 -- Legal/Trust surfaces). The signup form
 * links here ("By continuing you agree to Spencare's Terms and Privacy
 * Policy"), but this repository has no lawyer-drafted Terms of Service to
 * ship, and none is fabricated here -- inventing binding legal text
 * without counsel review would be worse than the gap it's covering.
 * This page exists so the link is honest (a real destination, clearly
 * marked as unfinished) rather than a promise pointing nowhere.
 *
 * MUST be replaced with the actual, reviewed Terms of Service before
 * Spencare is offered to real users -- do not treat this placeholder as
 * satisfying that requirement.
 */
export default function TermsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Terms of Service</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          Spencare&apos;s Terms of Service have not yet been finalized. This page is a
          placeholder and does not constitute a binding agreement.
        </p>
        <p>
          If you have questions about how Spencare works before a formal Terms of Service is
          published, please contact the team directly rather than relying on this page.
        </p>
        <p>
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
