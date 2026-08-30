export type { AiProviderAdapter, AiProviderName, AiEvent, ChatMessage, ToolDefinition } from "./provider.js";
export {
  ProviderOutageError,
  ProviderRateLimitError,
  MalformedProviderResponseError,
  NoProviderConfiguredError,
  ProviderNotImplementedError,
  ProviderAuthenticationError,
  ProviderPermissionError,
  ProviderModelNotFoundError,
  ProviderInvalidRequestError,
} from "./provider.js";

export { AnthropicAdapter } from "./adapters/anthropicAdapter.js";
export { FakeAiProviderAdapter, type FakeScenario } from "./adapters/fakeAdapter.js";

export { resolveProviderAdapter, buildAdapterForProvider, isProviderImplemented, IMPLEMENTED_PROVIDERS } from "./resolver.js";
export { buildAiContext, type AiContext } from "./context.js";

export {
  connectProvider,
  switchProvider,
  updateProviderKey,
  validateProviderKey,
  disconnectProvider,
  getActiveProvider,
  getProviderStatus,
  type ProviderMutationResult,
  type ProviderMutationError,
} from "./providerManagement.js";

export { proposeCommand, confirmCommand, cancelPendingCommand, getProposal, type ProposalResult, type ProposalPreviewField, type ConfirmResult, type ConfirmError } from "./confirmation.js";

export { getToolDefinitions, executeTool, type ToolExecutionResult } from "./tools/registry.js";
export { READ_TOOLS } from "./tools/readTools.js";
export { WRITE_TOOLS } from "./tools/writeTools.js";
export type { ToolHandlerContext } from "./tools/readTools.js";

export { sendMessage, type OrchestratorEvent, type SendMessageOptions, RATE_LIMIT_RETRY_BACKOFF_MS } from "./orchestrator.js";
export { SPENSA_SYSTEM_PROMPT } from "./systemPrompt.js";
export { getConversation, listConversations, getConversationMessages, deleteConversation, regenerateReply } from "./conversations.js";

// Re-exported so the Web UI never needs to import @spencare/domain-infra
// directly (dependency-cruiser's "no-web-ui-direct-database" rule) --
// packages/ai is the layer the UI is allowed to depend on for every
// AI/Spensa-related type, the same way packages/domain/application is for
// every other domain's row types.
export type { AiConversationRow, AiMessageRow, AiMessageRole, AiMessageContent, AiProvider, AiProviderStatus } from "@spencare/domain-infra";
