import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The one dead-end in the OAuth flow: reached only when this server
 * cannot safely redirect back to the requesting client at all (its
 * `redirect_uri` failed re-validation -- see actions.ts's own doc
 * comment for why that check exists on both Allow and Cancel). There is
 * deliberately no "go back" link that could itself become a redirect
 * vector; the user's only path forward is to close this tab and retry
 * the connection from the client (Claude/ChatGPT) itself.
 */
export default async function OAuthAuthorizeErrorPage(props: PageProps<"/oauth/authorize/error">) {
  const params = await props.searchParams;
  const reason = typeof params.reason === "string" ? params.reason : "unknown_error";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Can&apos;t complete this connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          {reason === "invalid_redirect_uri"
            ? "This app's redirect address doesn't match what's registered with Spencare, so nothing was sent back to it."
            : "Something went wrong completing this authorization request."}
        </p>
        <p>Close this window and try connecting again from the app you were setting up.</p>
      </CardContent>
    </Card>
  );
}
