import {
  getPublicSecuritySettings,
  type SecuritySettingsPublic,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

/** Never returns totp_secret_encrypted/backup_codes_hash -- only status flags. */
export async function getSecurityStatus(ctx: AuthContext): Promise<SecuritySettingsPublic | null> {
  return getPublicSecuritySettings(ctx.supabase, ctx.userId);
}
