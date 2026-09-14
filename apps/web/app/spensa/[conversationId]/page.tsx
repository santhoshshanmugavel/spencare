import { getConversation, getConversationMessages, listConversations } from "@spencare/ai";
import { getProfile, listAccounts, listCategories, listGoals, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { SpensaChat } from "./spensa-chat";

/**
 * `/spensa/[conversationId]` -- Phase 16's canonical, dedicated Spensa
 * route (locked decision #2), deep-linkable per `ai_conversations.id`.
 * `conversationId === "new"` is the one reserved literal (matching the
 * common Next.js "new resource, not yet assigned a real id" convention)
 * -- the client starts a fresh conversation through `sendMessage`'s own
 * application-layer path (a real `ai_conversations` insert, a real id),
 * never a client-generated UUID, then the URL updates to the real id once
 * the server returns it.
 *
 * No source screen mockup exists for this exact route (screen-catalog.md:
 * chat UI evidence lives entirely under `screens/dashboard/`, mixed with
 * documented CF-D02 anti-patterns) -- everything rendered here is
 * RECOMMENDED/INFERRED from the architecture and this codebase's existing
 * design system, following the same discipline Phase 15's Import screen
 * used for the same reason.
 */
export default async function SpensaConversationPage(props: PageProps<"/spensa/[conversationId]">) {
  const { conversationId } = await props.params;
  const searchParams = await props.searchParams;

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

  const isNew = conversationId === "new";
  const [conversations, accounts, categories, goals, existing, profile] = await Promise.all([
    listConversations(ctx),
    listAccounts(ctx),
    listCategories(ctx),
    listGoals(ctx),
    isNew ? Promise.resolve({ conversation: null, messages: [] }) : getConversationDataSafe(ctx, conversationId),
    getProfile(ctx),
  ]);

  // When navigating from Goals → "Create with Spensa AI", pass a starter
  // message so Spensa opens with goal-creation context immediately.
  const intentParam = (searchParams as Record<string, string | undefined>)?.intent;
  const starterMessage =
    isNew && intentParam === "create_goal"
      ? "I want to create a new savings goal."
      : null;

  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<img src="/spencare-icon.svg" alt="Spencare" width={24} height={24} className="shrink-0" />}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<><PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} /><NotificationBell /></>}
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <SpensaChat
        conversationId={isNew ? null : conversationId}
        initialMessages={existing.messages}
        conversations={conversations}
        accounts={accounts}
        categories={categories}
        goals={goals}
        starterMessage={starterMessage}
      />
    </AppShell>
  );
}

async function getConversationDataSafe(ctx: AuthContext, conversationId: string) {
  const conversation = await getConversation(ctx, conversationId);
  if (!conversation) return { conversation: null, messages: [] };
  const messages = await getConversationMessages(ctx, conversationId);
  return { conversation, messages };
}
