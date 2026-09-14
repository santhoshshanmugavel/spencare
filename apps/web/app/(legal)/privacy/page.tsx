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
        <p className="text-xs text-muted-foreground">Effective date: September 14, 2026</p>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <p className="text-muted-foreground leading-relaxed">
          Spencare (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is a personal finance
          management application. This Privacy Policy explains what data we collect, why we collect
          it, how we use it, and your rights over it. By using Spencare, you agree to this policy.
        </p>

        {/* ── 1. What Spencare Is ─────────────────────────────────────── */}
        <Section title="1. What Spencare Is">
          <p>
            Spencare is a personal finance management tool that helps you track spending, manage
            accounts, plan budgets, set savings goals, manage recurring bills, and interact with
            your financial data through an AI assistant called Spensa. All financial records in
            Spencare are entered manually or reviewed and confirmed by you — Spencare does not
            connect directly to banks or payment networks.
          </p>
        </Section>

        {/* ── 2. Information We Collect ───────────────────────────────── */}
        <Section title="2. Information We Collect">
          <p>
            <strong className="text-foreground">Account and authentication data:</strong> Your email
            address and, if you sign in with Google, your Google account display name and profile
            picture. If you enable two-factor authentication (2FA), your TOTP secret is stored
            encrypted on our servers.
          </p>
          <p>
            <strong className="text-foreground">Financial data:</strong> Transactions, account
            balances, categories, budgets, savings goals, bill records, and imported transaction
            data that you enter, import, or confirm within the application.
          </p>
          <p>
            <strong className="text-foreground">Gmail data (optional):</strong> If you choose to
            connect Gmail, we request read-only access to your Gmail messages using the{" "}
            <code className="text-xs">https://www.googleapis.com/auth/gmail.readonly</code> scope.
            We use this access solely to identify financial emails (receipts, bank alerts,
            statements, bills). See Section 5 for full details.
          </p>
          <p>
            <strong className="text-foreground">Telegram data (optional):</strong> If you connect
            Telegram for notifications, we store an association between your Spencare account and
            your Telegram chat ID. See Section 6 for full details.
          </p>
          <p>
            <strong className="text-foreground">AI interaction data:</strong> If you use the Spensa
            AI assistant, your queries and relevant financial context are sent to the AI provider
            you have configured. See Section 7 for full details.
          </p>
          <p>
            <strong className="text-foreground">Technical and usage data:</strong> Standard server
            request logs including IP addresses (used transiently for rate limiting and security),
            browser type, and the pages you access. We also use Microsoft Clarity for analytics
            and session recording. See Section 10 for full details.
          </p>
        </Section>

        {/* ── 3. How We Use Information ───────────────────────────────── */}
        <Section title="3. How We Use Information">
          <ul className="list-disc list-inside space-y-1">
            <li>To create, operate, and maintain your Spencare account</li>
            <li>To identify potential financial transactions from your Gmail (only if connected)</li>
            <li>To power the Spensa AI assistant with your financial context</li>
            <li>To send account-related notifications via in-app alerts, Telegram (if connected), or other channels you enable</li>
            <li>To detect and prevent fraud, abuse, and unauthorized access</li>
            <li>To improve Spencare&apos;s functionality and user experience</li>
          </ul>
          <p>We do not sell your data. We do not use your data for advertising purposes.</p>
        </Section>

        {/* ── 4. Third-Party Services ─────────────────────────────────── */}
        <Section title="4. Third-Party Services">
          <p>We use the following third-party services to operate Spencare:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong className="text-foreground">Supabase</strong> — database, authentication, and
              file storage. Your data is stored in the Asia Pacific (Sydney) region.
            </li>
            <li>
              <strong className="text-foreground">Vercel</strong> — application hosting and
              serverless function execution.
            </li>
            <li>
              <strong className="text-foreground">Google</strong> — Google Sign-In (social login)
              and Gmail OAuth (if you connect Gmail).
            </li>
            <li>
              <strong className="text-foreground">AI providers (user-configured)</strong> — Google
              Gemini, OpenAI, or Anthropic Claude, depending on which provider you configure in
              Settings → AI. Your API key is used only to process your own queries. See Section 7.
            </li>
            <li>
              <strong className="text-foreground">Telegram</strong> — for optional push
              notifications if you connect Telegram. See Section 6.
            </li>
            <li>
              <strong className="text-foreground">Microsoft Clarity</strong> — analytics and session
              recording. See Section 10.
            </li>
          </ul>
          <p>Each service has its own privacy policy governing their handling of data.</p>
        </Section>

        {/* ── 5. Gmail — Limited Use ──────────────────────────────────── */}
        <Section title="5. Gmail Permissions and Data Handling">
          <p>
            Spencare&apos;s use of data obtained from Google APIs adheres to the{" "}
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
          <p>
            <strong className="text-foreground">What we access:</strong> We request the{" "}
            <code className="text-xs">gmail.readonly</code> scope, which provides read-only access
            to your Gmail messages. We do not request any scope that would allow Spencare to send,
            delete, or modify your Gmail messages.
          </p>
          <p>
            <strong className="text-foreground">What we do with access:</strong> We read emails
            matching financial keywords (receipts, bank alerts, statements, bill confirmations) to
            identify potential transaction candidates. Candidate data (sender, subject, extracted
            amounts, dates) is surfaced to you for review in Settings → Gmail. We do not
            automatically create any financial record — every candidate requires your explicit
            confirmation before it becomes a transaction.
          </p>
          <p>
            <strong className="text-foreground">What we store:</strong> We store your OAuth refresh
            token, encrypted with AES-256-GCM, in order to maintain access between sessions. We
            do not durably store the full body or attachments of your emails — only extracted
            candidate data that you have not yet reviewed is retained, and only for as long as it
            is pending your action.
          </p>
          <p><strong className="text-foreground">Specifically, we commit to:</strong></p>
          <ul className="list-disc list-inside space-y-1">
            <li>Using Gmail data only to identify financial transactions on your behalf</li>
            <li>Not transferring Gmail data to third parties except as strictly necessary to operate the service</li>
            <li>Not using Gmail data for advertising or to train AI or machine learning models</li>
            <li>Not allowing humans to read your Gmail data except for security review purposes</li>
          </ul>
          <p>You can disconnect Gmail at any time from Settings → Gmail. Disconnecting immediately revokes our access and removes your stored OAuth credentials.</p>
        </Section>

        {/* ── 6. Telegram ─────────────────────────────────────────────── */}
        <Section title="6. Telegram Integration">
          <p>
            Connecting Telegram is entirely optional. You initiate the connection explicitly from
            Settings → Notifications. When connected, Spencare can send you supported
            notifications (bill reminders, budget alerts, daily summaries, and similar events)
            to your Telegram account via the{" "}
            <strong className="text-foreground">@Spencare_bot</strong> bot.
          </p>
          <p>
            We store an association between your Spencare account and your Telegram chat ID. We
            do not have access to your Telegram message history, other conversations, contacts,
            or any data outside of the messages sent by Spencare to you.
          </p>
          <p>
            You can disconnect Telegram at any time from Settings → Notifications. Disconnecting
            removes the stored association and stops all Telegram notifications.
          </p>
        </Section>

        {/* ── 7. AI / Spensa ──────────────────────────────────────────── */}
        <Section title="7. AI Assistant (Spensa) and Your Data">
          <p>
            Spensa is Spencare&apos;s AI assistant. Spencare does not operate a shared AI platform
            key — you connect your own AI provider API key (Google Gemini, OpenAI, or Anthropic
            Claude) in Settings → AI. Your API key is stored encrypted with AES-256-GCM and is
            used solely to process your own queries.
          </p>
          <p>
            When you interact with Spensa, your query and relevant financial context from your
            Spencare account (such as account balances, recent transactions, or budget data) are
            sent to the AI provider you have configured. This data is processed by that provider
            according to their own privacy policy and terms. We do not control how third-party AI
            providers handle, log, or retain data they receive.
          </p>
          <p>
            Financial calculations (balances, budget totals, net worth) are performed by the
            Spencare application and are not delegated to AI. Spensa explains and interprets your
            data — it does not recalculate it.
          </p>
          <p>
            AI-generated responses are informational in nature. They do not constitute financial,
            investment, tax, or legal advice.
          </p>
          <p>
            If you have Privacy Mode enabled, financial figures surfaced to Spensa are masked
            before being sent to the AI provider.
          </p>
        </Section>

        {/* ── 8. MCP / AI Client Access ───────────────────────────────── */}
        <Section title="8. MCP (AI Client) Access">
          <p>
            If you generate an MCP access token from Settings → MCP Access, you can connect a
            compatible AI client (such as Claude Desktop) to your Spencare account. MCP clients
            can read your financial data and propose changes. Every proposed write requires your
            explicit confirmation within the Spencare interface before any record is created or
            modified — MCP clients cannot directly write to your account.
          </p>
          <p>
            MCP tokens are stored as a cryptographic hash. You can view active sessions and
            revoke any token at any time from Settings → MCP Access.
          </p>
        </Section>

        {/* ── 9. Security ─────────────────────────────────────────────── */}
        <Section title="9. Security">
          <p>We implement the following security measures to protect your data:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong className="text-foreground">Row-level security (RLS)</strong> — enforced at
              the database level so your data is accessible only to your authenticated session
            </li>
            <li>
              <strong className="text-foreground">Encryption at rest</strong> — OAuth tokens
              (Gmail), AI provider API keys, TOTP secrets, and Telegram credentials are encrypted
              with AES-256-GCM before storage
            </li>
            <li>
              <strong className="text-foreground">Encryption in transit</strong> — all communication
              between your browser and Spencare uses HTTPS
            </li>
            <li>
              <strong className="text-foreground">Two-factor authentication</strong> — optional TOTP
              2FA is available for your account
            </li>
            <li>
              <strong className="text-foreground">CSRF protection</strong> — OAuth flows use
              cryptographic state tokens to prevent cross-site request forgery
            </li>
            <li>
              <strong className="text-foreground">Server-side credential handling</strong> — secret
              credentials are never exposed to client-side code
            </li>
            <li>
              <strong className="text-foreground">Confirmation before writes</strong> — proposed
              changes (including from the AI assistant and MCP clients) require explicit user
              confirmation
            </li>
          </ul>
          <p>
            No system is perfectly secure. While we take security seriously, we cannot guarantee
            absolute security of your data.
          </p>
        </Section>

        {/* ── 10. Analytics ───────────────────────────────────────────── */}
        <Section title="10. Analytics and Session Recording (Microsoft Clarity)">
          <p>
            Spencare uses Microsoft Clarity to collect analytics and session recording data. Clarity
            may record mouse movements, clicks, scrolling, and pages visited. This data is used
            to understand how Spencare is used and to identify areas for improvement.
          </p>
          <p>
            Clarity is loaded for all users who access Spencare when the service is configured.
            Microsoft&apos;s{" "}
            <a
              href="https://privacy.microsoft.com/en-us/privacystatement"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Privacy Statement
            </a>{" "}
            governs Clarity&apos;s handling of session data. Spencare does not control what data
            Clarity observes on screen during a session.
          </p>
        </Section>

        {/* ── 11. Cookies and Sessions ────────────────────────────────── */}
        <Section title="11. Cookies and Session Technologies">
          <p>
            Spencare uses cookies and similar browser storage to maintain your authenticated
            session. Session cookies are managed by Supabase Auth and are required for the
            application to function — there is no functional equivalent to opting out of session
            cookies while remaining signed in.
          </p>
          <p>
            We also use short-lived cookies during OAuth flows (e.g., the Gmail connection
            flow) to carry cryptographic state values that protect against cross-site request
            forgery. These are deleted immediately after the flow completes.
          </p>
          <p>
            Third-party services we use (Clarity, Supabase, Google) may set their own cookies
            subject to their respective policies.
          </p>
        </Section>

        {/* ── 12. Data Retention ──────────────────────────────────────── */}
        <Section title="12. Data Retention">
          <p>
            We retain your data for as long as your account is active and as necessary to provide
            the service, maintain security, and meet operational requirements.
          </p>
          <p>
            When you delete your account, your personal data and financial records are deleted.
            Gmail OAuth credentials are removed immediately when you disconnect Gmail from
            Settings → Gmail. MCP tokens are invalidated immediately when you revoke them from
            Settings → MCP Access.
          </p>
          <p>
            Some data may be retained for a limited period in backups or logs before being
            permanently removed. The repository does not define specific retention periods beyond
            immediate deletion for user-initiated actions.
          </p>
        </Section>

        {/* ── 13. Data Export ─────────────────────────────────────────── */}
        <Section title="13. Data Export">
          <p>
            You can export a copy of your Spencare data at any time from Settings → Data. The
            export is generated immediately and downloaded to your device as a JSON file. It
            includes your profile, accounts, transactions, budgets, goals, bills, and AI
            conversation history.
          </p>
          <p>
            The export does not include encrypted credentials, password material, or raw Gmail
            email content (email bodies are never stored by Spencare).
          </p>
        </Section>

        {/* ── 14. Account and Data Deletion ───────────────────────────── */}
        <Section title="14. Account and Data Deletion">
          <p>
            You can permanently delete your account from Settings → Data. Deletion requires you
            to confirm your account email address and, if two-factor authentication is enabled,
            your current 2FA code. Once confirmed, your account and all associated financial data
            are deleted immediately and cannot be recovered.
          </p>
        </Section>

        {/* ── 15. Your Choices ────────────────────────────────────────── */}
        <Section title="15. Your Choices">
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">Access your data:</strong> View everything you have recorded within the app</li>
            <li><strong className="text-foreground">Export your data:</strong> Settings → Data → Export my data</li>
            <li><strong className="text-foreground">Delete your account:</strong> Settings → Data → Delete my account</li>
            <li><strong className="text-foreground">Disconnect Gmail:</strong> Settings → Gmail — immediately revokes access and removes stored credentials</li>
            <li><strong className="text-foreground">Disconnect Telegram:</strong> Settings → Notifications — removes the connection and stops notifications</li>
            <li><strong className="text-foreground">Revoke MCP tokens:</strong> Settings → MCP Access — invalidates any active AI client session</li>
            <li><strong className="text-foreground">Enable Privacy Mode:</strong> Settings → Privacy — masks financial figures in the UI and limits what is shared with the AI assistant</li>
          </ul>
        </Section>

        {/* ── 16. Children ────────────────────────────────────────────── */}
        <Section title="16. Children">
          <p>
            Spencare is not directed at children under 13. We do not knowingly collect personal
            data from children under 13. If you believe a child under 13 has provided us with
            personal data, please contact us.
          </p>
        </Section>

        {/* ── 17. Changes to This Policy ──────────────────────────────── */}
        <Section title="17. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by updating the effective date at the top of this page and, where appropriate,
            by notifying you within the application. Continued use of Spencare after changes are
            posted constitutes your acceptance of the updated policy.
          </p>
        </Section>

        {/* ── 18. Contact ─────────────────────────────────────────────── */}
        <Section title="18. Contact">
          <p>
            If you have questions about this policy, your data, or how we handle your information,
            contact us at{" "}
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
