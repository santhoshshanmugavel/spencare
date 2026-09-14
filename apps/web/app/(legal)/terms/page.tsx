import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Terms of Service — Spencare",
  description: "Terms governing your use of the Spencare personal finance application.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Terms of Service</CardTitle>
        <p className="text-xs text-muted-foreground">Effective date: September 14, 2026</p>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <p className="text-muted-foreground leading-relaxed">
          Please read these Terms of Service (&ldquo;Terms&rdquo;) carefully before using Spencare.
          By creating an account or using the Spencare application, you agree to be bound by these
          Terms. If you do not agree, do not use Spencare.
        </p>

        {/* ── 1. Acceptance of Terms ──────────────────────────────────── */}
        <Section title="1. Acceptance of Terms">
          <p>
            These Terms constitute a binding agreement between you and the operator of the Spencare
            service (&ldquo;Spencare&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;, or
            &ldquo;us&rdquo;) governing your access to and use of the Spencare application
            available at{" "}
            <strong className="text-foreground">https://spencare.vercel.app</strong> and its
            associated features.
          </p>
          <p>
            By accessing or using Spencare — including by creating an account, connecting a Gmail
            account, or using the Spensa AI assistant — you confirm that you have read, understood,
            and agree to these Terms and our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

        {/* ── 2. Description of Spencare ──────────────────────────────── */}
        <Section title="2. Description of Spencare">
          <p>
            Spencare is a personal finance management application. It helps you track spending,
            manage accounts, plan budgets, work toward savings goals, manage recurring bills, and
            interact with your financial data through an AI assistant called Spensa.
          </p>
          <p>
            Spencare does not connect to banks, payment networks, credit card issuers, or any
            financial institution on your behalf. All financial records are entered manually by
            you, imported via CSV file upload, or derived from emails you have connected through
            the optional Gmail integration and confirmed by you before any record is created.
            Spencare does not initiate, authorize, or execute any financial transaction.
          </p>
        </Section>

        {/* ── 3. Eligibility ──────────────────────────────────────────── */}
        <Section title="3. Eligibility">
          <p>
            You must be at least 13 years old to use Spencare. By using Spencare you represent
            that you meet this age requirement and that you have the legal capacity to enter into
            these Terms.
          </p>
        </Section>

        {/* ── 4. Accounts ─────────────────────────────────────────────── */}
        <Section title="4. Accounts">
          <p>
            You are responsible for maintaining the confidentiality of your account credentials,
            including your password and any two-factor authentication codes. You are responsible
            for all activity that occurs under your account.
          </p>
          <p>
            You agree to provide accurate and current information when creating your account and
            to keep it up to date. You may not share your account with others or use another
            person&apos;s account without their permission.
          </p>
          <p>
            Please notify us promptly at{" "}
            <a href="mailto:hey.me.santhosh@gmail.com" className="text-primary hover:underline">
              hey.me.santhosh@gmail.com
            </a>{" "}
            if you believe your account has been compromised.
          </p>
        </Section>

        {/* ── 5. User Responsibilities ────────────────────────────────── */}
        <Section title="5. User Responsibilities">
          <p>You agree to use Spencare only for lawful purposes and in accordance with these Terms. You are responsible for the accuracy of the financial data you enter or import. You agree not to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Use Spencare in any way that violates applicable laws or regulations</li>
            <li>Attempt to gain unauthorized access to Spencare&apos;s systems, servers, or databases</li>
            <li>Reverse-engineer, decompile, or disassemble any part of the service</li>
            <li>Interfere with or disrupt the integrity or performance of Spencare</li>
            <li>Use automated means to access Spencare in a way that violates these Terms or places excessive load on the service</li>
            <li>Use Spencare to transmit malware, viruses, or other harmful code</li>
            <li>Attempt to circumvent authentication or security controls</li>
          </ul>
        </Section>

        {/* ── 6. Financial Information and Educational Nature ──────────── */}
        <Section title="6. Financial Information and Educational Nature">
          <p>
            Spencare is a personal productivity and tracking tool. Nothing in Spencare — including
            data displays, calculations, summaries, charts, budget analyses, or goal projections —
            constitutes financial advice, investment advice, tax advice, legal advice, or any
            other form of regulated professional advice.
          </p>
          <p>
            The financial data you see in Spencare reflects only the records you have entered or
            confirmed. It may not reflect your actual financial position, may omit accounts or
            liabilities you have not entered, and should not be relied upon as a complete or
            authoritative view of your finances.
          </p>
          <p>
            Always consult a qualified financial professional before making significant financial
            decisions.
          </p>
        </Section>

        {/* ── 7. AI-Generated Information (Spensa) ────────────────────── */}
        <Section title="7. AI-Generated Information (Spensa)">
          <p>
            Spensa, Spencare&apos;s AI assistant, generates responses using large language models
            provided by third-party AI providers (Google Gemini, OpenAI, or Anthropic Claude,
            depending on your configuration). AI-generated content may be inaccurate, incomplete,
            outdated, or inappropriate for your specific situation.
          </p>
          <p>
            AI responses from Spensa do not constitute financial, investment, tax, or legal advice.
            You should not rely solely on Spensa&apos;s output for financial decisions. Spensa can
            make errors and may misinterpret your data or question. We make no warranty as to the
            accuracy, completeness, or fitness of any AI-generated response.
          </p>
          <p>
            Proposed write actions from Spensa (such as adding a transaction or creating a goal)
            require your explicit confirmation before any record is created or modified.
          </p>
        </Section>

        {/* ── 8. Your Data ────────────────────────────────────────────── */}
        <Section title="8. Your Data">
          <p>
            You retain ownership of the financial data and records you enter into Spencare. You
            grant us a limited license to store, process, and display your data solely as necessary
            to provide the Spencare service to you.
          </p>
          <p>
            We do not sell your data, use it for advertising, or share it with third parties
            except as described in our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            (e.g., to the AI provider you have configured when you use Spensa, or to Supabase
            as our database infrastructure provider).
          </p>
          <p>
            You can export your data at any time from Settings → Data, and delete your account
            and all associated data from the same location.
          </p>
        </Section>

        {/* ── 9. Gmail Integration ────────────────────────────────────── */}
        <Section title="9. Gmail Integration">
          <p>
            The Gmail integration is optional. By connecting Gmail, you authorize Spencare to
            read your Gmail messages using the{" "}
            <code className="text-xs">gmail.readonly</code> scope for the purpose of identifying
            potential financial transactions. You understand that:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>No transaction is created automatically — every Gmail-identified candidate requires your explicit confirmation</li>
            <li>Spencare does not send Gmail messages on your behalf</li>
            <li>You can disconnect Gmail at any time from Settings → Gmail</li>
            <li>Your Gmail refresh token is stored encrypted and is deleted immediately upon disconnection</li>
          </ul>
          <p>
            By connecting Gmail you also agree to Google&apos;s Terms of Service and Privacy Policy.
            Spencare&apos;s use of Gmail data complies with the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including Limited Use requirements.
          </p>
        </Section>

        {/* ── 10. Telegram Integration ────────────────────────────────── */}
        <Section title="10. Telegram Integration">
          <p>
            The Telegram integration is optional. By connecting Telegram, you authorize Spencare
            to send notifications to your Telegram account via the @Spencare_bot bot. Spencare
            does not read your Telegram message history or access any data outside of messages
            it sends to you. You can disconnect Telegram at any time from Settings → Notifications.
          </p>
          <p>
            By connecting Telegram you also agree to Telegram&apos;s Terms of Service and Privacy
            Policy.
          </p>
        </Section>

        {/* ── 11. Third-Party Services ────────────────────────────────── */}
        <Section title="11. Third-Party Services">
          <p>
            Spencare relies on third-party services including Supabase, Vercel, Google, Microsoft
            Clarity, and the AI provider you configure. Your use of these services through
            Spencare is subject to their respective terms and privacy policies. We are not
            responsible for the practices of third-party services.
          </p>
          <p>
            Spencare does not endorse or make any representation about the accuracy, reliability,
            or security of any third-party service.
          </p>
        </Section>

        {/* ── 12. Prohibited Uses ─────────────────────────────────────── */}
        <Section title="12. Prohibited Uses">
          <p>You may not use Spencare to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Record, track, or process data belonging to another person without their express consent</li>
            <li>Engage in money laundering, fraud, or any other illegal financial activity</li>
            <li>Probe, scan, or test the vulnerability of any Spencare system without written authorization</li>
            <li>Attempt to extract, harvest, or scrape data from Spencare for any unauthorized purpose</li>
            <li>Impersonate any person or entity</li>
          </ul>
        </Section>

        {/* ── 13. Intellectual Property ───────────────────────────────── */}
        <Section title="13. Intellectual Property">
          <p>
            Spencare and its original content, features, and functionality are owned by the
            operator and are protected by applicable intellectual property laws. The Spencare name,
            logo, and design are proprietary. You may not copy, modify, distribute, or create
            derivative works based on Spencare without written permission.
          </p>
          <p>
            You retain all rights to the financial data and content you enter into Spencare.
          </p>
        </Section>

        {/* ── 14. Service Availability ────────────────────────────────── */}
        <Section title="14. Service Availability">
          <p>
            We strive to keep Spencare available, but we do not guarantee uninterrupted access.
            Spencare may be unavailable due to maintenance, technical issues, outages at
            third-party providers (including Supabase and Vercel), or circumstances beyond our
            control.
          </p>
          <p>
            We reserve the right to modify, suspend, or discontinue any part of Spencare at any
            time with or without notice. We are not liable for any loss resulting from such
            interruptions or changes.
          </p>
        </Section>

        {/* ── 15. Disclaimers ─────────────────────────────────────────── */}
        <Section title="15. Disclaimers">
          <p>
            <strong className="text-foreground">
              Spencare is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
              warranties of any kind, express or implied.
            </strong>{" "}
            To the fullest extent permitted by applicable law, we disclaim all warranties,
            including but not limited to implied warranties of merchantability, fitness for a
            particular purpose, accuracy, and non-infringement.
          </p>
          <p>
            We do not warrant that Spencare will meet your requirements, that it will be
            error-free, or that any defects will be corrected. We are not responsible for errors
            in data you enter, for decisions you make based on information in Spencare, or for
            the output of third-party AI providers.
          </p>
        </Section>

        {/* ── 16. Limitation of Liability ─────────────────────────────── */}
        <Section title="16. Limitation of Liability">
          <p>
            To the fullest extent permitted by applicable law, we shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, including but not
            limited to loss of data, loss of profits, loss of savings, or financial losses of any
            kind, arising out of or in connection with your use of Spencare — even if we have been
            advised of the possibility of such damages.
          </p>
          <p>
            Our total liability to you for any claim arising from or related to these Terms or
            Spencare shall not exceed the greater of (a) the amount you paid for Spencare in the
            twelve months preceding the claim, or (b) one hundred US dollars (USD $100), to the
            extent permitted by law.
          </p>
        </Section>

        {/* ── 17. Indemnification ─────────────────────────────────────── */}
        <Section title="17. Indemnification">
          <p>
            You agree to defend, indemnify, and hold harmless Spencare and its operators from
            any claims, damages, losses, liabilities, costs, or expenses (including reasonable
            legal fees) arising from: (a) your use of Spencare; (b) your violation of these
            Terms; (c) your violation of any third-party rights; or (d) any data you submit to
            Spencare.
          </p>
        </Section>

        {/* ── 18. Suspension and Termination ──────────────────────────── */}
        <Section title="18. Suspension and Termination">
          <p>
            We reserve the right to suspend or terminate your access to Spencare at any time,
            with or without notice, if we reasonably believe you have violated these Terms or
            if continued access poses a risk to the service or other users.
          </p>
          <p>
            You may delete your account at any time from Settings → Data. Upon deletion, your data
            is removed as described in our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          <p>
            Sections 6, 7, 13, 15, 16, 17, and 20 of these Terms survive termination.
          </p>
        </Section>

        {/* ── 19. Changes to the Service ──────────────────────────────── */}
        <Section title="19. Changes to the Service">
          <p>
            We may modify, add, or remove features of Spencare at any time. We will try to
            provide notice of significant changes through the application where practical, but
            are not obligated to do so for minor updates.
          </p>
        </Section>

        {/* ── 20. Changes to These Terms ──────────────────────────────── */}
        <Section title="20. Changes to These Terms">
          <p>
            We may update these Terms from time to time. When we do, we will update the effective
            date at the top of this page. Where changes are material, we will provide notice
            within the application or by email where practicable. Continued use of Spencare after
            updated Terms are posted constitutes your acceptance of the updated Terms.
          </p>
        </Section>

        {/* ── 21. Governing Law ───────────────────────────────────────── */}
        <Section title="21. Governing Law">
          <p>
            These Terms shall be governed by and construed in accordance with applicable laws,
            without regard to conflict of law principles. Because Spencare is a personal tool
            used by individuals in different jurisdictions, specific governing law and dispute
            resolution provisions will be determined in a future update to these Terms following
            appropriate legal review.
          </p>
          <p>
            In the meantime, we encourage you to contact us directly at{" "}
            <a href="mailto:hey.me.santhosh@gmail.com" className="text-primary hover:underline">
              hey.me.santhosh@gmail.com
            </a>{" "}
            to resolve any concern before pursuing formal channels.
          </p>
        </Section>

        {/* ── 22. Contact ─────────────────────────────────────────────── */}
        <Section title="22. Contact">
          <p>
            If you have questions about these Terms or Spencare&apos;s policies, contact us at{" "}
            <a href="mailto:hey.me.santhosh@gmail.com" className="text-primary hover:underline">
              hey.me.santhosh@gmail.com
            </a>
            .
          </p>
        </Section>

        <div className="flex gap-4 pt-2 text-xs">
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
