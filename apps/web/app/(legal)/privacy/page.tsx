import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Privacy Policy — Spencare",
  description: "How Spencare collects, uses, and protects your personal and financial data.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Privacy Policy</CardTitle>
        <p className="text-xs text-muted-foreground">Effective date: September 10, 2026</p>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <p className="text-muted-foreground leading-relaxed">
          Spencare (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is a personal finance
          management application. This Privacy Policy explains what data we collect, why we collect
          it, how we use it, and your rights over it. By using Spencare, you agree to this policy.
        </p>

        <Section title="1. Data We Collect">
          <p><strong className="text-foreground">Account data:</strong> When you sign up, we collect your email address and, if you use Google Sign-In, your Google account name and profile picture.</p>
          <p><strong className="text-foreground">Financial data:</strong> Transactions, account balances, budgets, savings goals, and bill records that you enter manually or that are identified from your Gmail.</p>
          <p><strong className="text-foreground">Gmail data (optional):</strong> If you choose to connect Gmail, we request read-only access to your Gmail messages (<code className="text-xs">gmail.readonly</code> scope) solely to identify financial emails (receipts, bank statements, bills). We do not read, store, or share the content of non-financial emails. Gmail access is optional and can be revoked at any time.</p>
          <p><strong className="text-foreground">AI usage data:</strong> If you use the Spensa AI assistant, your financial queries and relevant account context are sent to Google&apos;s Gemini API to generate responses. No personally identifiable information beyond what you explicitly ask about is sent.</p>
          <p><strong className="text-foreground">Technical data:</strong> IP addresses (used transiently for rate limiting), browser type, and standard server logs.</p>
        </Section>

        <Section title="2. How We Use Your Data">
          <ul className="list-disc list-inside space-y-1">
            <li>To provide and operate the Spencare service</li>
            <li>To identify financial transactions from your Gmail (only if you connect it)</li>
            <li>To power the Spensa AI assistant with your financial context</li>
            <li>To send account-related notifications (e.g. bill reminders)</li>
            <li>To protect against fraud, abuse, and unauthorized access</li>
          </ul>
          <p>We do not sell your data. We do not use your data for advertising.</p>
        </Section>

        <Section title="3. Gmail Data — Limited Use Disclosure">
          <p>
            Spencare&apos;s use of data obtained from Google APIs, including Gmail, adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>Specifically:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Gmail data is used only to identify financial transactions on your behalf</li>
            <li>Gmail data is not transferred to third parties except as necessary to operate the service</li>
            <li>Gmail data is not used for advertising or to train AI/ML models</li>
            <li>Gmail data is not shared with humans except for security review</li>
            <li>Your Gmail access token is encrypted with AES-256-GCM before being stored</li>
            <li>You can disconnect Gmail at any time from Settings → Gmail</li>
          </ul>
        </Section>

        <Section title="4. Data Storage and Security">
          <p>Your data is stored in Supabase (hosted in the Asia Pacific — Sydney region). We apply:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Row-level security (RLS) — your data is only accessible by you</li>
            <li>AES-256-GCM encryption for all stored OAuth tokens (Gmail, AI providers)</li>
            <li>HTTPS for all data in transit</li>
            <li>Optional two-factor authentication (TOTP) for your account</li>
          </ul>
        </Section>

        <Section title="5. Third-Party Services">
          <p>We use the following third-party services to operate Spencare:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Supabase</strong> — database, authentication, and file storage</li>
            <li><strong className="text-foreground">Google Gemini API</strong> — AI assistant responses (your queries are processed by Google)</li>
            <li><strong className="text-foreground">Google OAuth</strong> — sign-in and Gmail access</li>
            <li><strong className="text-foreground">Vercel</strong> — application hosting</li>
          </ul>
          <p>Each service has its own privacy policy governing their use of data.</p>
        </Section>

        <Section title="6. MCP (AI Client) Access">
          <p>
            If you generate an MCP token under Settings → MCP Access, you can connect a third-party
            AI assistant (such as Claude) to your Spencare account. MCP clients can read your
            financial data and propose changes — but every proposed write requires your explicit
            confirmation before anything is recorded. You can revoke MCP tokens at any time.
          </p>
        </Section>

        <Section title="7. Data Retention">
          <p>
            We retain your data for as long as your account is active. If you delete your account,
            your personal data and financial records are permanently deleted from our systems within
            30 days. Gmail tokens are deleted immediately on disconnection.
          </p>
        </Section>

        <Section title="8. Your Rights">
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Access:</strong> You can view all your data within the app</li>
            <li><strong className="text-foreground">Export:</strong> You can export your financial data from Settings → Data</li>
            <li><strong className="text-foreground">Deletion:</strong> You can delete your account and all data from Settings → Security</li>
            <li><strong className="text-foreground">Gmail revocation:</strong> Disconnect Gmail at any time from Settings → Gmail</li>
            <li><strong className="text-foreground">MCP revocation:</strong> Revoke any AI client token from Settings → MCP Access</li>
          </ul>
        </Section>

        <Section title="9. Children">
          <p>
            Spencare is not directed at children under 13. We do not knowingly collect data from
            children under 13.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this policy. We will notify you of material changes via the app or by
            email. Continued use after changes constitutes acceptance.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about this policy or your data? Contact us at{" "}
            <a href="mailto:hello@santhoshdesign.com" className="text-primary hover:underline">
              hello@santhoshdesign.com
            </a>
            .
          </p>
        </Section>

        <div className="flex gap-4 pt-2 text-xs">
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
