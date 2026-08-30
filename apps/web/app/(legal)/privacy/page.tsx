import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder ONLY (Phase 21 -- Legal/Trust surfaces). See terms/page.tsx's
 * header comment for why this exists and what it is not: no fabricated
 * privacy-policy text, just an honest placeholder the signup link can
 * point to. MUST be replaced with a real, reviewed Privacy Policy
 * (including Gmail-data-handling and AI-provider-data-handling
 * disclosures) before Spencare is offered to real users.
 */
export default function PrivacyPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Privacy Policy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          Spencare&apos;s Privacy Policy has not yet been finalized. This page is a placeholder
          and does not describe Spencare&apos;s actual data-handling commitments.
        </p>
        <p>
          If you have questions about how your data is stored or used before a formal Privacy
          Policy is published, please contact the team directly rather than relying on this page.
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
