export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // pdfjs-dist (pulled in by pdf-parse → @spencare/domain-infra) calls
    // `new DOMMatrix()` at module evaluation time. Node.js does not provide
    // DOMMatrix; we install a minimal stub here so the module loads without
    // crashing. pdf-parse is used only for server-side text extraction from
    // uploaded bank statements — no actual PDF rendering happens, so the
    // identity-matrix stub is sufficient.
    if (typeof (globalThis as Record<string, unknown>).DOMMatrix === "undefined") {
      class DOMMatrixStub {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        m11 = 1; m12 = 0; m13 = 0; m14 = 0;
        m21 = 0; m22 = 1; m23 = 0; m24 = 0;
        m31 = 0; m32 = 0; m33 = 1; m34 = 0;
        m41 = 0; m42 = 0; m43 = 0; m44 = 1;
        is2D = true; isIdentity = true;
        constructor(_init?: string | number[]) {}
        multiply() { return new DOMMatrixStub(); }
        translate() { return new DOMMatrixStub(); }
        scale() { return new DOMMatrixStub(); }
        rotate() { return new DOMMatrixStub(); }
        rotateAxisAngle() { return new DOMMatrixStub(); }
        skewX() { return new DOMMatrixStub(); }
        skewY() { return new DOMMatrixStub(); }
        flipX() { return new DOMMatrixStub(); }
        flipY() { return new DOMMatrixStub(); }
        inverse() { return new DOMMatrixStub(); }
        transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
        toFloat32Array() { return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]); }
        toFloat64Array() { return new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]); }
        toJSON() { return {}; }
        toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
        static fromFloat32Array() { return new DOMMatrixStub(); }
        static fromFloat64Array() { return new DOMMatrixStub(); }
        static fromMatrix() { return new DOMMatrixStub(); }
      }
      (globalThis as Record<string, unknown>).DOMMatrix = DOMMatrixStub;
    }

    // Register Telegram webhook + bot commands on cold start (idempotent).
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      void (async () => {
        try {
          const TARGET_URL = "https://spencare.vercel.app/api/telegram/webhook";

          // Register webhook only when the URL has changed
          const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
          const info = (await infoRes.json()) as { ok: boolean; result?: { url: string } };
          if (info.result?.url !== TARGET_URL) {
            const body: Record<string, string> = { url: TARGET_URL };
            const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
            if (secret) body.secret_token = secret;
            await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
          }

          // Register bot commands (idempotent — safe every cold start)
          await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              commands: [
                { command: "start", description: "Connect your Spencare account" },
                { command: "help", description: "See what Spensa can help with" },
                { command: "settings", description: "Manage notification preferences" },
                { command: "disconnect", description: "Disconnect Telegram from Spencare" },
              ],
            }),
          });
        } catch {
          // Non-fatal — bot token may not be set in dev/preview
        }
      })();
    }
  }
}
