/**
 * Multi-Provider Types and Configuration
 * Supports Anthropic, OpenAI, and Gemini providers for Brain Chat
 */

// Provider identifiers
export type Provider = 'anthropic' | 'openai' | 'gemini';

// Model tier for UI grouping
export type ModelTier = 'cheap' | 'better';

// Model definition with pricing
export interface ModelDefinition {
  id: string;
  displayName: string;
  provider: Provider;
  tier: ModelTier;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

// Provider configuration
export interface ProviderConfig {
  id: Provider;
  name: string;
  keyPrefix: string;
  storageKey: string;
  modelStorageKey: string;
  consoleUrl: string;
  usageUrl: string;
  supportsWebSearch: boolean;
  supportsCodeExecution: boolean;
  placeholder: string;
  helpText: string;
}

// All provider configurations
export const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    keyPrefix: 'sk-ant-',
    storageKey: 'brain_anthropic_api_key',
    modelStorageKey: 'brain_anthropic_model',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    usageUrl: 'https://console.anthropic.com/usage',
    supportsWebSearch: true,
    supportsCodeExecution: true,
    placeholder: 'sk-ant-...',
    helpText: 'You need an Anthropic account with API access and available credits.',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyPrefix: 'sk-',
    storageKey: 'brain_openai_api_key',
    modelStorageKey: 'brain_openai_model',
    consoleUrl: 'https://platform.openai.com/api-keys',
    usageUrl: 'https://platform.openai.com/usage',
    supportsWebSearch: true,
    supportsCodeExecution: true,
    placeholder: 'sk-proj-...',
    helpText: 'You need an OpenAI account with API access and available credits.',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    keyPrefix: 'AIza',
    storageKey: 'brain_gemini_api_key',
    modelStorageKey: 'brain_gemini_model',
    consoleUrl: 'https://aistudio.google.com/apikey',
    usageUrl: 'https://aistudio.google.com/apikey',
    supportsWebSearch: true,
    supportsCodeExecution: true,
    placeholder: 'AIza...',
    helpText: 'You need a Google account. Gemini API has a generous free tier.',
  },
};

// All available models (December 2025 pricing)
export const MODELS: ModelDefinition[] = [
  // Anthropic
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    provider: 'anthropic',
    tier: 'cheap',
    inputCostPerMillion: 1.00,
    outputCostPerMillion: 5.00,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    displayName: 'Sonnet 4.5',
    provider: 'anthropic',
    tier: 'better',
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
  },

  // OpenAI
  {
    id: 'gpt-5-nano',
    displayName: 'GPT-5 Nano',
    provider: 'openai',
    tier: 'cheap',
    inputCostPerMillion: 0.05,
    outputCostPerMillion: 0.40,
  },
  {
    id: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    provider: 'openai',
    tier: 'better',
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 2.00,
  },

  // Gemini
  {
    id: 'gemini-3-flash-preview',
    displayName: 'Flash 3',
    provider: 'gemini',
    tier: 'cheap',
    inputCostPerMillion: 0.50,
    outputCostPerMillion: 3.00,
  },
  {
    id: 'gemini-3-pro-preview',
    displayName: 'Pro 3 Preview',
    provider: 'gemini',
    tier: 'better',
    inputCostPerMillion: 2.00,
    outputCostPerMillion: 12.00,
  },
];

// localStorage keys
export const STORAGE_KEYS = {
  ACTIVE_PROVIDER: 'brain_api_provider',
  // Individual provider keys are in PROVIDERS[provider].storageKey
  // Individual model selections are in PROVIDERS[provider].modelStorageKey
  CHAT_HISTORY: 'brain_chat_messages',
  WEB_SEARCH: 'brain_chat_web_search',
  WEB_FETCH: 'brain_chat_web_fetch',
  CODE_EXECUTION: 'brain_chat_code_execution',
} as const;

// Web search cost (Anthropic only)
export const WEB_SEARCH_COST = 0.01; // $0.01 per search

// Token usage tracking
export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  cost: number;
}

// Streaming callbacks interface
export interface StreamCallbacks {
  onStart?: () => void;
  onToken?: (token: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: string) => void;
  onUsage?: (usage: UsageData) => void;
  // Tool callbacks (Anthropic-specific, but exposed for UI)
  onWebSearch?: (query: string) => void;
  onWebSearchResults?: (resultCount: number) => void;
  onWebFetch?: (url: string) => void;
  onWebFetchComplete?: () => void;
  onCodeExecution?: (status: string) => void;
  onCodeExecutionComplete?: () => void;
  onToolError?: (toolName: string, error: string) => void;
  // File loading (custom tool for all providers)
  onFileLoad?: (path: string) => void;
  onFileLoaded?: (path: string, success: boolean) => void;
}

// Tool definition for custom tools (like load_file)
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

// Options for sending a message
export interface SendMessageOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt: string;
  apiKey: string;
  modelId: string;
  callbacks: StreamCallbacks;
  tools?: ToolDefinition[];
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  enableCodeExecution?: boolean;
  abortSignal?: AbortSignal;
  // Function to load file contents (injected from brain-chat)
  loadFileContents?: (paths: string[]) => Promise<Array<{ path: string; content: string }>>;
}

// Validation result
export interface KeyValidationResult {
  valid: boolean;
  error?: string;
}

// Provider module interface
export interface ProviderModule {
  validateKey: (key: string) => Promise<KeyValidationResult>;
  sendMessage: (options: SendMessageOptions) => Promise<void>;
  getModels: () => ModelDefinition[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a model by its ID
 */
export function getModelById(modelId: string): ModelDefinition | undefined {
  return MODELS.find(m => m.id === modelId);
}

/**
 * Get all models for a specific provider
 */
export function getModelsForProvider(provider: Provider): ModelDefinition[] {
  return MODELS.filter(m => m.provider === provider);
}

/**
 * Get the default model for a provider (cheap tier)
 */
export function getDefaultModelForProvider(provider: Provider): ModelDefinition {
  const models = getModelsForProvider(provider);
  return models.find(m => m.tier === 'cheap') || models[0];
}

/**
 * Calculate cost for a given usage
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  webSearches: number = 0
): number {
  const model = getModelById(modelId);
  if (!model) return 0;

  const inputCost = (inputTokens / 1_000_000) * model.inputCostPerMillion;
  const outputCost = (outputTokens / 1_000_000) * model.outputCostPerMillion;
  const searchCost = webSearches * WEB_SEARCH_COST;

  return inputCost + outputCost + searchCost;
}

/**
 * Get provider config by ID
 */
export function getProviderConfig(provider: Provider): ProviderConfig {
  return PROVIDERS[provider];
}

/**
 * Validate key format (prefix check only, not API validation)
 */
export function validateKeyFormat(key: string, provider: Provider): boolean {
  const config = PROVIDERS[provider];
  // OpenAI keys can be 'sk-' or 'sk-proj-'
  if (provider === 'openai') {
    return key.startsWith('sk-');
  }
  return key.startsWith(config.keyPrefix);
}

/**
 * Get list of all providers
 */
export function getAllProviders(): Provider[] {
  return ['anthropic', 'openai', 'gemini'];
}

/**
 * Load file tool definition (shared across all providers)
 */
export const LOAD_FILE_TOOL: ToolDefinition = {
  name: 'load_file',
  description: 'Load a file from the brain repository to read its contents. Use this when you need to read a file that is listed in the Available Files section.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to load (e.g., "research/newsletters/every/20251205-ai-update.md")',
      },
    },
    required: ['path'],
  },
};
