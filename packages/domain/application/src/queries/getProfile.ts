import { getProfile as getProfileRow, type ProfileRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function getProfile(ctx: AuthContext): Promise<ProfileRow | null> {
  return getProfileRow(ctx.supabase, ctx.userId);
}
