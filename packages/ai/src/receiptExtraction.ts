/**
 * Receipt/document extraction via the user's configured AI provider.
 *
 * Uses the same key resolver as Spensa chat. Only extracts -- never writes.
 * The caller must pipe the structured result through the existing proposal /
 * confirmation flow before any transaction is created.
 *
 * Currently Anthropic-only for vision; other providers get a clear capability
 * error instead of a fabricated result.
 */

import Anthropic from "@anthropic-ai/sdk";
import { decryptSecret, getActiveEncryptedCredential } from "@spencare/domain-infra";
import type { AuthContext } from "@spencare/domain-application";
import { NoProviderConfiguredError } from "./provider.js";

export interface ReceiptExtraction {
  merchantName: string | null;
  itemName: string | null;
  amountMinor: number | null;
  currency: string | null;
  occurredAt: string | null;
  categorySuggestion: string | null;
  confidence: "high" | "medium" | "low";
  rawText: string | null;
}

export class ReceiptExtractionCapabilityError extends Error {
  constructor(provider: string) {
    super(`Receipt extraction is not yet supported for provider '${provider}'. Connect an Anthropic provider to use this feature.`);
    this.name = "ReceiptExtractionCapabilityError";
  }
}

const EXTRACTION_PROMPT = `You are a receipt parser. Extract structured information from the provided image of a receipt, invoice, or financial document.

Return ONLY a JSON object with these fields:
{
  "merchantName": string or null,
  "itemName": string or null (main item/service if identifiable),
  "amountMinor": integer in the smallest currency unit (e.g. paise for INR, cents for USD) or null,
  "currency": 3-letter ISO code or null,
  "occurredAt": ISO date string YYYY-MM-DD or null,
  "categorySuggestion": one of "food", "transport", "entertainment", "shopping", "utilities", "health", "education", "travel" or null,
  "confidence": "high", "medium", or "low",
  "rawText": the main text you can read from the image or null
}

Rules:
- Never invent values. Use null when uncertain.
- amountMinor: convert to integer minor units (multiply by 100 for INR/USD). If the receipt shows ₹420, return 42000.
- occurredAt: extract the date the purchase occurred, not the statement date.
- confidence: "high" if you can read most fields clearly, "medium" if some are ambiguous, "low" if the image is unclear.
- Return ONLY the JSON object, no explanation.`;

export async function extractReceiptFromImage(
  ctx: AuthContext,
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif",
): Promise<ReceiptExtraction> {
  const credential = await getActiveEncryptedCredential(ctx.serviceRoleSupabase, ctx.userId);
  if (!credential) throw new NoProviderConfiguredError();

  if (credential.provider !== "anthropic") {
    throw new ReceiptExtractionCapabilityError(credential.provider);
  }

  const apiKey = decryptSecret(credential.encryptedApiKey, process.env.AI_PROVIDER_ENCRYPTION_KEY);
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return {
      merchantName: null, itemName: null, amountMinor: null, currency: null,
      occurredAt: null, categorySuggestion: null, confidence: "low", rawText: null,
    };
  }

  try {
    const raw = textBlock.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(raw) as Partial<ReceiptExtraction>;
    return {
      merchantName: typeof parsed.merchantName === "string" ? parsed.merchantName : null,
      itemName: typeof parsed.itemName === "string" ? parsed.itemName : null,
      amountMinor: typeof parsed.amountMinor === "number" ? Math.round(parsed.amountMinor) : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : null,
      categorySuggestion: typeof parsed.categorySuggestion === "string" ? parsed.categorySuggestion : null,
      confidence: (["high", "medium", "low"] as const).includes(parsed.confidence as never)
        ? (parsed.confidence as "high" | "medium" | "low")
        : "low",
      rawText: typeof parsed.rawText === "string" ? parsed.rawText : null,
    };
  } catch {
    return {
      merchantName: null, itemName: null, amountMinor: null, currency: null,
      occurredAt: null, categorySuggestion: null, confidence: "low",
      rawText: textBlock.text.slice(0, 500),
    };
  }
}
