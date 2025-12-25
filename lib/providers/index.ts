/**
 * Provider Router
 * Routes requests to the appropriate provider implementation
 */

import type {
  Provider,
  ProviderModule,
  SendMessageOptions,
  KeyValidationResult,
  ModelDefinition,
  ProviderConfig,
} from './types';

import {
  PROVIDERS,
  STORAGE_KEYS,
  getModelsForProvider,
  getDefaultModelForProvider,
  getAllProviders,
} from './types';

// Re-export types
export * from './types';

// Import provider implementations
import * as anthropicProvider from './anthropic';
import * as openaiProvider from './openai';
import * as geminiProvider from './gemini';

// Provider registry
const providers: Record<Provider, ProviderModule> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
};

// ============================================================================
// PROVIDER ROUTING
// ============================================================================

/**
 * Get a provider module by ID
 */
export function getProvider(providerId: Provider): ProviderModule {
  return providers[providerId];
}

/**
 * Validate an API key for a specific provider
 */
export async function validateKey(
  providerId: Provider,
  key: string
): Promise<KeyValidationResult> {
  const provider = getProvider(providerId);
  return provider.validateKey(key);
}

/**
 * Send a message using a specific provider
 */
export async function sendMessage(
  providerId: Provider,
  options: SendMessageOptions
): Promise<void> {
  const provider = getProvider(providerId);
  return provider.sendMessage(options);
}

/**
 * Get models for a specific provider
 */
export function getModels(providerId: Provider): ModelDefinition[] {
  const provider = getProvider(providerId);
  return provider.getModels();
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

/**
 * Safely access localStorage
 */
function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Get the active provider
 */
export function getActiveProvider(): Provider {
  const storage = safeLocalStorage();
  if (!storage) return 'anthropic';

  const saved = storage.getItem(STORAGE_KEYS.ACTIVE_PROVIDER);
  if (saved === 'anthropic' || saved === 'openai' || saved === 'gemini') {
    // Only return if that provider has a key configured
    const config = PROVIDERS[saved];
    if (storage.getItem(config.storageKey)) {
      return saved;
    }
  }

  // Fallback: find first provider with a configured key
  for (const provider of getAllProviders()) {
    const config = PROVIDERS[provider];
    if (storage.getItem(config.storageKey)) {
      return provider;
    }
  }

  // Default to anthropic if no keys configured
  return 'anthropic';
}

/**
 * Set the active provider
 */
export function setActiveProvider(provider: Provider): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEYS.ACTIVE_PROVIDER, provider);
}

/**
 * Get API key for a specific provider
 */
export function getApiKey(provider: Provider): string | null {
  const storage = safeLocalStorage();
  if (!storage) return null;

  const config = PROVIDERS[provider];
  return storage.getItem(config.storageKey);
}

/**
 * Set API key for a specific provider
 */
export function setApiKey(provider: Provider, key: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;

  const config = PROVIDERS[provider];
  storage.setItem(config.storageKey, key);
}

/**
 * Clear API key for a specific provider
 */
export function clearApiKey(provider: Provider): void {
  const storage = safeLocalStorage();
  if (!storage) return;

  const config = PROVIDERS[provider];
  storage.removeItem(config.storageKey);
}

/**
 * Check if a provider has an API key configured
 */
export function hasApiKey(provider: Provider): boolean {
  return !!getApiKey(provider);
}

/**
 * Get selected model for a provider
 */
export function getSelectedModel(provider: Provider): string {
  const storage = safeLocalStorage();
  if (!storage) {
    return getDefaultModelForProvider(provider).id;
  }

  const config = PROVIDERS[provider];
  const saved = storage.getItem(config.modelStorageKey);

  if (saved) {
    // Verify the saved model belongs to this provider
    const models = getModelsForProvider(provider);
    if (models.some(m => m.id === saved)) {
      return saved;
    }
  }

  return getDefaultModelForProvider(provider).id;
}

/**
 * Set selected model for a provider
 */
export function setSelectedModel(provider: Provider, modelId: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;

  const config = PROVIDERS[provider];
  storage.setItem(config.modelStorageKey, modelId);
}

/**
 * Get all providers with their key status
 */
export function getProvidersWithStatus(): Array<{
  config: ProviderConfig;
  hasKey: boolean;
  isActive: boolean;
}> {
  const activeProvider = getActiveProvider();
  return getAllProviders().map(provider => ({
    config: PROVIDERS[provider],
    hasKey: hasApiKey(provider),
    isActive: provider === activeProvider,
  }));
}

// ============================================================================
// MIGRATION
// ============================================================================

/**
 * Run migration for existing users
 * - Preserves existing Anthropic API key
 * - Sets active provider based on existing key
 * - Migrates model selection to provider-specific storage
 */
export function runMigration(): void {
  const storage = safeLocalStorage();
  if (!storage) return;

  // Check if migration already done
  if (storage.getItem(STORAGE_KEYS.ACTIVE_PROVIDER)) {
    return; // Already migrated
  }

  // Check for existing Anthropic key
  const anthropicKey = storage.getItem(PROVIDERS.anthropic.storageKey);
  if (anthropicKey) {
    // Set Anthropic as active provider
    storage.setItem(STORAGE_KEYS.ACTIVE_PROVIDER, 'anthropic');
  }

  // Migrate old model selection
  const oldModel = storage.getItem('brain_chat_model');
  if (oldModel) {
    // Map old model IDs to new ones
    const modelMap: Record<string, string> = {
      'haiku': 'claude-haiku-4-5-20251001',
      'sonnet': 'claude-sonnet-4-5-20250929',
      'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514': 'claude-sonnet-4-5-20250929',
    };

    const newModel = modelMap[oldModel] || oldModel;

    // If it looks like an Anthropic model, save to Anthropic model storage
    if (newModel.includes('claude') || modelMap[oldModel]) {
      storage.setItem(PROVIDERS.anthropic.modelStorageKey, newModel);
    }
  }
}
