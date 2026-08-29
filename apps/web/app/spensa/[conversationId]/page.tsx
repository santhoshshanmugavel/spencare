import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import { getConversation, getConversationMessages, listConversations } from "@spencare/ai";
import { listAccounts, listCategories, listGoals, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
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
  const [conversations, accounts, categories, goals, existing] = await Promise.all([
    listConversations(ctx),
    listAccounts(ctx),
    listCategories(ctx),
    listGoals(ctx),
    isNew ? Promise.resolve({ conversation: null, messages: [] }) : getConversationDataSafe(ctx, conversationId),
  ]);

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={[
            { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
            { key: "cash-flow", label: "Cash Flow", icon: <ArrowLeftRight className="size-5" />, href: "/cash-flow" },
            { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals" },
            { key: "settings", label: "Settings", icon: <SettingsIcon className="size-5" />, href: "/settings/profile" },
          ]}
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
