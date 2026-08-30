import type { Metadata } from "next";
import { Google_Sans_Flex, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Global application typography (Phase 23). Google Sans Flex is a
 * variable font (weight 1-1000, plus optical-size/grade/width/slant
 * axes) served through next/font/google exactly like Geist was --
 * self-hosted at build time, zero extra runtime request, zero new
 * dependency.
 *
 * Named `--font-sans` directly (not `--font-google-sans-flex`) because
 * that is the one variable globals.css's `@theme inline` block actually
 * reads (`--font-sans: var(--font-sans)`, intentionally self-referencing
 * so the theme layer stays generic and whatever concrete font this file
 * loads is picked up from the DOM). Phase 23 forensic finding: the
 * previous Geist setup named its variable `--font-geist-sans` --
 * `@theme inline` was never able to see it, so `font-sans` (and
 * `font-heading`, which derives from it) resolved to NOTHING and the
 * entire app was silently rendering in the browser's default serif
 * font, not Geist -- confirmed live via `getComputedStyle(document.
 * body).fontFamily` returning `"Times"` before this fix. Naming this
 * loader's variable `--font-sans` directly is the standard shadcn/
 * Tailwind v4 pattern and fixes that root cause at the same time as
 * migrating the family.
 */
const googleSansFlex = Google_Sans_Flex({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spencare",
  description: "Spend smarter with Spencare",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${googleSansFlex.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
