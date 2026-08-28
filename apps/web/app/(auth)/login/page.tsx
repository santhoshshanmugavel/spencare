import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleButton } from "@/components/spencare/google-button";
import { signInWithGoogleAction } from "../actions";
import { LoginForm } from "./login-form";

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const redirectTarget = typeof params.redirect === "string" ? params.redirect : null;
  const error = typeof params.error === "string" ? params.error : null;
  const resetSuccess = params.reset === "success";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {resetSuccess ? (
          <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            Your password was updated. Sign in with your new password.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <LoginForm redirectTarget={redirectTarget} />
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
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
