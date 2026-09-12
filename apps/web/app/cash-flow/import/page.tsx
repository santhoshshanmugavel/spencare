import { getProfile, listAccounts, listCategories, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { filterByCapability } from "@spencare/domain-core";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { ImportWizard } from "./import-wizard";

/**
 * `/cash-flow/import` -- Phase 15's standalone Import screen (locked
 * decision #4: canonical route, additive, reachable independently of
 * Spensa/chat, no existing Cash Flow route restructured). No source
 * screen mockup exists for this route (screen-catalog.md's own words:
 * "no dedicated import screens exist in the reviewed source set... needs
 * to be designed net-new") -- everything rendered here is RECOMMENDED/
 * INFERRED from the architecture and this codebase's existing design
 * system, not extracted from a screen spec.
 */
export default async function ImportPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
  const [accounts, categories, profile] = await Promise.all([listAccounts(ctx), listCategories(ctx), getProfile(ctx)]);
  // Phase 28 Part 8: Credit Card is a valid import destination (expense
  // rows only -- confirm_import_batch itself rejects a batch containing
  // any income row against a credit card, never a silent partial
  // import). Investment is excluded: it is not a normal transaction
  // account and no statement-import format for it is supported here.
  const eligibleAccounts = filterByCapability(accounts, "expenseSource");


  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />}
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <div className="mx-auto max-w-2xl py-8">
        <ImportWizard accounts={eligibleAccounts} categories={categories} />
      </div>
    </AppShell>
  );
}
