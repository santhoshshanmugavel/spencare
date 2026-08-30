import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateAuthorizationCode,
  hashAuthorizationCode,
  generateOAuthClientId,
  verifyPkceChallenge,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
} from "./oauth.js";

describe("generateAuthorizationCode / hashAuthorizationCode", () => {
  it("generates a unique, high-entropy code each call", () => {
    const a = generateAuthorizationCode();
    const b = generateAuthorizationCode();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
  });

  it("hashes deterministically -- the same code always hashes the same way", () => {
    const code = generateAuthorizationCode();
    expect(hashAuthorizationCode(code)).toBe(hashAuthorizationCode(code));
  });

  it("never stores or exposes the raw code from its hash (one-way)", () => {
    const code = generateAuthorizationCode();
    const hash = hashAuthorizationCode(code);
    expect(hash).not.toContain(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest
  });

  it("two different codes never collide", () => {
    const a = hashAuthorizationCode(generateAuthorizationCode());
    const b = hashAuthorizationCode(generateAuthorizationCode());
    expect(a).not.toBe(b);
  });
});

describe("generateOAuthClientId", () => {
  it("generates a unique identifier each call", () => {
    expect(generateOAuthClientId()).not.toBe(generateOAuthClientId());
  });

  it("is a plain, safe-to-store public identifier (not secret-shaped)", () => {
    expect(generateOAuthClientId()).toMatch(/^spc_client_/);
  });
});

describe("verifyPkceChallenge (S256)", () => {
  function challengeFor(verifier: string): string {
    return createHash("sha256").update(verifier, "utf8").digest("base64url");
  }

  it("accepts the correct verifier for a given challenge", () => {
    const verifier = "a-real-random-code-verifier-the-client-generated-1234567890";
    expect(verifyPkceChallenge(verifier, challengeFor(verifier))).toBe(true);
  });

  it("rejects a completely wrong verifier", () => {
    const verifier = "the-real-verifier";
    const challenge = challengeFor(verifier);
    expect(verifyPkceChallenge("an-attacker-supplied-verifier", challenge)).toBe(false);
  });

  it("rejects a verifier that differs by only one character", () => {
    const verifier = "abcdefghijklmnopqrstuvwxyz0123456789";
    const challenge = challengeFor(verifier);
    const almostRight = verifier.slice(0, -1) + "X";
    expect(verifyPkceChallenge(almostRight, challenge)).toBe(false);
  });

  it("rejects an empty verifier against a real challenge", () => {
    const challenge = challengeFor("something");
    expect(verifyPkceChallenge("", challenge)).toBe(false);
  });

  it("rejects when the challenge itself is empty/malformed", () => {
    expect(verifyPkceChallenge("some-verifier", "")).toBe(false);
  });

  it("is not vulnerable to a naive length-based short-circuit -- a challenge of different length is still safely rejected", () => {
    const verifier = "correct-verifier";
    expect(verifyPkceChallenge(verifier, "short")).toBe(false);
    expect(verifyPkceChallenge(verifier, "a-much-much-much-longer-string-than-any-real-challenge-would-be")).toBe(false);
  });
});

describe("TTL constants", () => {
  it("the authorization code TTL is short (a single redirect hop, not a standing credential)", () => {
    expect(OAUTH_AUTHORIZATION_CODE_TTL_SECONDS).toBeLessThanOrEqual(600); // RFC 6749 §4.1.2's own 10-minute ceiling
    expect(OAUTH_AUTHORIZATION_CODE_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("the OAuth-issued access token TTL is bounded, unlike the manual token flow's unlimited default", () => {
    expect(OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBeGreaterThan(0);
    expect(OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBeLessThan(60 * 60 * 24 * 365); // under a year
  });
});
