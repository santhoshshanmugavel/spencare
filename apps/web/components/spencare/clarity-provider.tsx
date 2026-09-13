"use client";

import { useEffect } from "react";
import Clarity from "@microsoft/clarity";

export function ClarityProvider() {
  useEffect(() => {
    const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
    if (!projectId) return;
    // Guard against double-init on React strict-mode double-invoke or HMR.
    // Clarity.init is idempotent but the tag call would duplicate — guard anyway.
    if (typeof window === "undefined") return;
    Clarity.init(projectId);
    Clarity.setTag("app", "spencare");
    // Force high-fidelity recording from the first visit.
    Clarity.upgrade("spencare-session");
  }, []);

  return null;
}
