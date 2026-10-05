import Link from "next/link";
import { FallingGlitch } from "@/components/spencare/falling-glitch";

export default function NotFound() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <FallingGlitch>
        <div className="flex flex-col items-center justify-center gap-6 px-6 text-center">
          <h1
            className="text-7xl font-bold leading-none text-white drop-shadow-[0_0_18px_rgba(0,0,0,0.6)] md:text-9xl"
            style={{ fontFamily: "'Dancing Script', ui-serif, Georgia, serif" }}
          >
            404
          </h1>
          <p className="max-w-md text-sm text-white/80 md:text-base">
            This page slipped through the cracks. Let&apos;s get you back to your money.
          </p>
          <Link
            href="https://spencare.vercel.app/"
            className="inline-flex items-center justify-center rounded-full border border-white/40 bg-white/10 px-6 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Back to Spencare
          </Link>
        </div>
      </FallingGlitch>
    </main>
  );
}
