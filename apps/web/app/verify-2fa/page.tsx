import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyTwoFactorForm } from "./verify-2fa-form";

export default async function VerifyTwoFactorPage(props: PageProps<"/verify-2fa">) {
  const params = await props.searchParams;
  const redirectTarget = typeof params.redirect === "string" ? params.redirect : null;

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <span className="text-2xl font-bold text-primary">
            Spencare
          </span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Two-factor verification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code from your authenticator app to finish signing in.
            </p>
            <VerifyTwoFactorForm redirectTarget={redirectTarget} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
