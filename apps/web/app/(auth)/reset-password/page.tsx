import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Requires an active RECOVERY session -- established only via a valid,
 * unexpired reset link exchanged at /auth/callback. There is no
 * client-visible "token" field on this page (invalid/expired links are
 * rejected at the callback, before the user ever reaches this form).
 */
export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
