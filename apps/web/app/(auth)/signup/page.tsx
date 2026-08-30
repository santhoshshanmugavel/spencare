import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleButton } from "@/components/spencare/google-button";
import { isGoogleSignInEnabled } from "@/lib/supabase/auth-providers";
import { signInWithGoogleAction } from "../actions";
import { SignUpForm } from "./signup-form";

export default async function SignUpPage(props: PageProps<"/signup">) {
  const params = await props.searchParams;
  const redirectTarget = typeof params.redirect === "string" ? params.redirect : null;
  const googleEnabled = await isGoogleSignInEnabled();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <SignUpForm redirectTarget={redirectTarget} />
        {googleEnabled ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>
            <GoogleButton
              action={signInWithGoogleAction.bind(null, redirectTarget)}
              label="Continue with Google"
            />
          </>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
