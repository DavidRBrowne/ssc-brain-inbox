/**
 * Brain Chat utilities
 * Handles API key management, file loading, and multi-provider API calls
 */

// Import provider system
import {
  type Provider,
  type ModelDefinition,
  type StreamCallbacks as ProviderStreamCallbacks,
  type UsageData,
  PROVIDERS,
  MODELS,
  STORAGE_KEYS,
  getModelsForProvider,
  getModelById,
  getDefaultModelForProvider,
  calculateCost as providerCalculateCost,
  getAllProviders,
  WEB_SEARCH_COST,
} from './providers';

import {
  getActiveProvider as getActiveProviderFromStorage,
  setActiveProvider as setActiveProviderInStorage,
  getApiKey as getProviderApiKey,
  setApiKey as setProviderApiKey,
  clearApiKey as clearProviderApiKey,
  hasApiKey as providerHasApiKey,
  getSelectedModel as getProviderSelectedModel,
  setSelectedModel as setProviderSelectedModel,
  getProvidersWithStatus,
  runMigration,
  sendMessage as providerSendMessage,
  validateKey as providerValidateKey,
} from './providers';

// Re-export types from providers
export type { Provider, ModelDefinition, UsageData };
export { PROVIDERS, MODELS, STORAGE_KEYS, getAllProviders, getModelsForProvider, getModelById, getDefaultModelForProvider, WEB_SEARCH_COST };
export { getProvidersWithStatus, runMigration };

// Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface LoadedFile {
  path: string;
  content: string;
  tokenEstimate: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

// Helper to safely access localStorage
function safeLocalStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ============================================================================
// API KEY MANAGEMENT (Multi-provider)
// ============================================================================

/**
 * Get API key for a provider (defaults to active provider)
 */
export function getApiKey(provider?: Provider): string | null {
  const targetProvider = provider || getActiveProviderFromStorage();
  return getProviderApiKey(targetProvider);
}

/**
 * Set API key for a provider (defaults to active provider)
 */
export function setApiKey(key: string, provider?: Provider): void {
  const targetProvider = provider || getActiveProviderFromStorage();
  setProviderApiKey(targetProvider, key);
}

/**
 * Clear API key for a provider (defaults to active provider)
 */
export function clearApiKey(provider?: Provider): void {
  const targetProvider = provider || getActiveProviderFromStorage();
  clearProviderApiKey(targetProvider);
}

/**
 * Validate API key for a provider (defaults to active provider)
 */
export async function validateApiKey(key: string, provider?: Provider): Promise<{ valid: boolean; error?: string }> {
  const targetProvider = provider || getActiveProviderFromStorage();
  return providerValidateKey(targetProvider, key);
}

/**
 * Get the active provider
 */
export function getActiveProvider(): Provider {
  return getActiveProviderFromStorage();
}

/**
 * Set the active provider
 */
export function setActiveProvider(provider: Provider): void {
  setActiveProviderInStorage(provider);
}

/**
 * Check if a provider has an API key
 */
export function hasApiKey(provider?: Provider): boolean {
  const targetProvider = provider || getActiveProviderFromStorage();
  return providerHasApiKey(targetProvider);
}

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

// Rough estimate: ~4 characters per token for English text
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

// ============================================================================
// FILE LOADING
// ============================================================================

export async function loadFileContents(paths: string[]): Promise<LoadedFile[]> {
  if (paths.length === 0) return [];

  try {
    const response = await fetch('/api/inbox/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });

    if (!response.ok) {
      throw new Error('Failed to load files');
    }

    const data = await response.json();
    return data.files.map((file: { path: string; content: string }) => ({
      path: file.path,
      content: file.content,
      tokenEstimate: estimateTokens(file.content),
    }));
  } catch (err) {
    console.error('Failed to load file contents:', err);
    return [];
  }
}

export async function fetchFileTree(): Promise<FileNode[]> {
  try {
    const response = await fetch('/api/inbox/files');
    if (!response.ok) {
      throw new Error('Failed to fetch file tree');
    }
    const data = await response.json();
    return data.tree || [];
  } catch (err) {
    console.error('Failed to fetch file tree:', err);
    return [];
  }
}

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

const MAX_CONTEXT_TOKENS = 150000;
const WARN_CONTEXT_TOKENS = 50000;

/**
 * Build a flat list of all file paths from the tree
 */
function flattenFileTree(nodes: FileNode[], paths: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'file' && node.name.endsWith('.md')) {
      paths.push(node.path);
    }
    if (node.type === 'dir' && node.children) {
      flattenFileTree(node.children, paths);
    }
  }
  return paths;
}

/**
 * Extract date from filename (YYYYMMDD format)
 * Returns numeric date for sorting, or 0 if no date found
 */
function extractDateFromPath(path: string): number {
  // Match YYYYMMDD pattern in filename
  const match = path.match(/(\d{8})/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

export interface ToolOptions {
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  enableCodeExecution?: boolean;
}

export function buildSystemPrompt(files: LoadedFile[], fileTree?: FileNode[], toolOptions?: ToolOptions): string {
  const fileContents = files.map(f =>
    `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``
  ).join('\n\n');

  // Build available files list from tree with FULL directory structure
  // This is critical for Claude to find files like research/newsletters/ethan/
  let availableFilesSection = '';
  if (fileTree && fileTree.length > 0) {
    const allPaths = flattenFileTree(fileTree);

    // Group by FULL parent directory path (e.g., research/newsletters/ethan)
    const grouped: Record<string, string[]> = {};
    for (const path of allPaths) {
      const parts = path.split('/');
      // Get directory path (everything except filename)
      const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
      if (!grouped[dirPath]) grouped[dirPath] = [];
      grouped[dirPath].push(path);
    }

    // Sort directories alphabetically, then sort files within each by date (newest first)
    const sortedDirs = Object.keys(grouped).sort();

    const lines: string[] = [];
    for (const dir of sortedDirs) {
      const dirPaths = grouped[dir];
      // Sort files by date (newest first)
      const sortedPaths = [...dirPaths].sort((a, b) => {
        const dateA = extractDateFromPath(a);
        const dateB = extractDateFromPath(b);
        return dateB - dateA; // Newest first
      });

      // Show directory with file count
      lines.push(`\n**${dir}/** (${sortedPaths.length} files)`);

      // Show 3 most recent files with just the filename
      const examples = sortedPaths.slice(0, 3);
      for (const ex of examples) {
        const filename = ex.split('/').pop() || ex;
        lines.push(`  - ${filename}`);
      }
      if (sortedPaths.length > 3) {
        lines.push(`  - ... ${sortedPaths.length - 3} more`);
      }
    }

    availableFilesSection = `\n\n## Available Files (organized by folder)
When loading a file, use the FULL PATH: folder + filename (e.g., \`research/newsletters/ethan/20251118-filename.md\`)

${lines.join('\n')}`;
  }

  // Build tools section based on enabled tools
  let toolsSection = '';
  const enabledTools: string[] = [];
  if (toolOptions?.enableWebSearch) {
    enabledTools.push('**Web Search**: You MUST use this tool immediately when the user asks about news, current events, recent information, or anything that requires up-to-date data. DO NOT ask permission or offer to search - just search. DO NOT say "I could search" - just do it.');
  }
  if (toolOptions?.enableWebFetch) {
    enabledTools.push('**URL Fetch**: You can fetch and read content from URLs. Use this when the user provides a URL or asks you to read a webpage.');
  }
  if (toolOptions?.enableCodeExecution) {
    enabledTools.push('**Code Execution**: You can write and execute Python code in a sandbox. Use this for calculations, data analysis, or when the user asks you to run code.');
  }
  if (enabledTools.length > 0) {
    toolsSection = `\n\n## Available Tools - USE THESE PROACTIVELY
You have these tools enabled. When relevant, USE THEM IMMEDIATELY without asking:

${enabledTools.map(t => `- ${t}`).join('\n')}

CRITICAL: When a user asks a question that these tools can answer, USE THE TOOL IMMEDIATELY. Do not offer to use it, do not ask permission, do not say "I could" - just use it. The user enabled these tools because they want you to use them.`;
  }

  return `You are a helpful assistant with access to the user's brain repository - a personal knowledge management system.

## Your Role
- Help the user understand and work with their notes, research, and documentation
- Reference specific files when answering questions
- Quote relevant sections from loaded files

## Directory Guide - WHERE TO FIND THINGS
- **todo/** - Tasks and action items
- **projects/** - Project notes and plans
- **customers/** - Customer/client information and notes
- **content/** - Posts, videos, course content (OUTPUT)
- **context/** - Business docs, ideas, strategy guides
- **research/** - Newsletters and YouTube transcripts (INPUT)
  - research/newsletters/INDEX.md - master index for all newsletters
  - research/youtube/INDEX.md - master index for all YouTube transcripts
  - Subfolders: indy/, lenny/, ethan/, simon/, etc. (no INDEX.md in subfolders)
- **.claude/skills/** - Available automation skills
- **.claude/commands/** - Slash commands

**NOTE**: INDEX.md files are only at research/newsletters/ and research/youtube/ level, NOT in individual source subfolders.

## Loaded Files
The following files from the user's brain are currently loaded and you can read their contents:

${fileContents || '(No files loaded yet)'}
${availableFilesSection}
${toolsSection}

## File Loading Rules
You have a \`load_file\` tool to read files from the user's brain.

**IMPORTANT: If files are already loaded above, USE THEM to answer the question. Don't ask for INDEX.md or offer choices - just answer based on the loaded content.**

**Only use INDEX.md workflow when NO relevant files are loaded:**
1. For research/newsletters/ or research/youtube/ → load the INDEX.md at that level
2. INDEX.md files show all available content with dates and titles
3. Then offer the user choices

**DATE FORMAT**: YYYYMMDD (20251118 = Nov 18, 2025). Higher = more recent.

## Guidelines
- Be concise and direct
- Reference file paths when citing information
- Use the load_file tool to read files you need - don't ask the user to load them
- If the user wants to save something, help them format it as markdown for their !inbox folder
- Don't make up information that isn't in the loaded files`;
}

export function getContextStatus(files: LoadedFile[]): {
  totalTokens: number;
  isOverLimit: boolean;
  isWarning: boolean;
  message: string;
} {
  const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);
  const isOverLimit = totalTokens > MAX_CONTEXT_TOKENS;
  const isWarning = totalTokens > WARN_CONTEXT_TOKENS && !isOverLimit;

  let message = `${formatTokenCount(totalTokens)} tokens loaded`;
  if (isOverLimit) {
    message = `Context too large (${formatTokenCount(totalTokens)}/${formatTokenCount(MAX_CONTEXT_TOKENS)}). Remove some files.`;
  } else if (isWarning) {
    message = `${formatTokenCount(totalTokens)} tokens - approaching limit`;
  }

  return { totalTokens, isOverLimit, isWarning, message };
}

// ============================================================================
// MODEL SELECTION (Multi-provider)
// ============================================================================

// Legacy type alias for backward compatibility
export type ModelId = 'haiku' | 'sonnet';

// Legacy MODELS object for backward compatibility with chat page
export const LEGACY_MODELS: Record<ModelId, {
  id: string;
  name: string;
  description: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}> = {
  haiku: {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku',
    description: 'Fast & affordable',
    inputPricePerMillion: 1.00,
    outputPricePerMillion: 5.00,
  },
  sonnet: {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Sonnet',
    description: 'More capable',
    inputPricePerMillion: 3.00,
    outputPricePerMillion: 15.00,
  },
};

/**
 * Calculate cost for a given usage (multi-provider)
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  webSearches: number = 0
): number {
  return providerCalculateCost(inputTokens, outputTokens, modelId, webSearches);
}

/**
 * Get selected model for the active provider
 */
export function getSelectedModel(): string {
  const provider = getActiveProviderFromStorage();
  return getProviderSelectedModel(provider);
}

/**
 * Set selected model for the active provider
 */
export function setSelectedModel(modelId: string): void {
  const provider = getActiveProviderFromStorage();
  setProviderSelectedModel(provider, modelId);
}

/**
 * Get models for the active provider
 */
export function getActiveProviderModels(): ModelDefinition[] {
  const provider = getActiveProviderFromStorage();
  return getModelsForProvider(provider);
}

// ============================================================================
// TOOL SETTINGS
// ============================================================================

const WEB_SEARCH_STORAGE_KEY = 'brain_chat_web_search';
const WEB_FETCH_STORAGE_KEY = 'brain_chat_web_fetch';
const CODE_EXECUTION_STORAGE_KEY = 'brain_chat_code_execution';

export function getWebSearchEnabled(): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  return storage.getItem(WEB_SEARCH_STORAGE_KEY) === 'true';
}

export function setWebSearchEnabled(enabled: boolean): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.setItem(WEB_SEARCH_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function getWebFetchEnabled(): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  return storage.getItem(WEB_FETCH_STORAGE_KEY) === 'true';
}

export function setWebFetchEnabled(enabled: boolean): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.setItem(WEB_FETCH_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function getCodeExecutionEnabled(): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  return storage.getItem(CODE_EXECUTION_STORAGE_KEY) === 'true';
}

export function setCodeExecutionEnabled(enabled: boolean): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.setItem(CODE_EXECUTION_STORAGE_KEY, enabled ? 'true' : 'false');
}

// ============================================================================
// STREAMING CALLBACKS (Re-export from providers)
// ============================================================================

export interface StreamCallbacks extends ProviderStreamCallbacks {}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface SendMessageOptions {
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  enableCodeExecution?: boolean;
}

// ============================================================================
// SEND MESSAGE (Multi-provider)
// ============================================================================

/**
 * Send a message using the active provider
 * This function wraps the provider-specific sendMessage with Brain Chat context
 */
export async function sendMessage(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  apiKey: string,
  callbacks: StreamCallbacks,
  modelId?: string,
  options: SendMessageOptions = {}
): Promise<void> {
  const provider = getActiveProviderFromStorage();
  const providerConfig = PROVIDERS[provider];

  // Use provided modelId or get selected model for provider
  const actualModelId = modelId || getProviderSelectedModel(provider);

  // Only enable web search/code execution for Anthropic
  const enableWebSearch = options.enableWebSearch && providerConfig.supportsWebSearch;
  const enableCodeExecution = options.enableCodeExecution && providerConfig.supportsCodeExecution;

  // Create file loader function
  const fileLoader = async (paths: string[]) => {
    const files = await loadFileContents(paths);
    return files.map(f => ({ path: f.path, content: f.content }));
  };

  await providerSendMessage(provider, {
    messages,
    systemPrompt,
    apiKey,
    modelId: actualModelId,
    callbacks,
    enableWebSearch,
    enableWebFetch: options.enableWebFetch,
    enableCodeExecution,
    loadFileContents: fileLoader,
  });
}

// ============================================================================
// FILE SEARCH / AUTO-DISCOVERY
// ============================================================================

/**
 * Extract keywords from a user's question for file matching
 * CONSERVATIVE: Only matches on known source names/aliases to avoid loading irrelevant files
 */
export function extractKeywords(query: string): string[] {
  // Only match on KNOWN SOURCE NAMES - don't match on generic words
  // This prevents loading random files when user asks about unrelated topics
  const knownSources: Record<string, string[]> = {
    // YouTube channels
    'indy dev dan': ['research/youtube/indy'],
    'indy': ['research/youtube/indy'],
    'lenny': ['research/youtube/lenny'],
    'lenny rachitsky': ['research/youtube/lenny'],
    'lenny\'s podcast': ['research/youtube/lenny'],
    'anthropic': ['research/youtube/anthropic'],
    'no priors': ['research/youtube/nopriors'],
    'nopriors': ['research/youtube/nopriors'],
    'this day in ai': ['research/youtube/thisday'],
    'thisday': ['research/youtube/thisday'],
    'ai engineer': ['research/youtube/aie'],
    'aie': ['research/youtube/aie'],

    // Newsletter authors
    'ethan': ['research/newsletters/ethan'],
    'ethan mollick': ['research/newsletters/ethan'],
    'one useful thing': ['research/newsletters/ethan'],
    'simon': ['research/newsletters/simon'],
    'simon willison': ['research/newsletters/simon'],
    'avinash': ['research/newsletters/avinash'],
    'avinash kaushik': ['research/newsletters/avinash'],
    'sam': ['research/newsletters/sam'],
    'sam tomlinson': ['research/newsletters/sam'],
    'ben': ['research/newsletters/ben'],
    'ben tossell': ['research/newsletters/ben'],
    'ben\'s bites': ['research/newsletters/ben'],
    'exponential': ['research/newsletters/exponential'],
    'exponential view': ['research/newsletters/exponential'],
    'azeem': ['research/newsletters/exponential'],
    'dan shipper': ['research/newsletters/every'],
    'every newsletter': ['research/newsletters/every'],

    // Folder shortcuts
    'newsletter': ['research/newsletters'],
    'newsletters': ['research/newsletters'],
    'youtube': ['research/youtube'],
    'research': ['research'],
    'todo': ['todo'],
    'todos': ['todo'],
    'projects': ['projects'],
    'customers': ['customers'],
    'travel': ['travel'],
  };

  const queryLower = query.toLowerCase();
  const matchedPaths: string[] = [];

  // Only return paths for explicitly mentioned sources
  for (const [phrase, paths] of Object.entries(knownSources)) {
    if (queryLower.includes(phrase)) {
      matchedPaths.push(...paths);
    }
  }

  // Remove duplicates and return folder paths (not keywords)
  return [...new Set(matchedPaths)];
}

/**
 * Recursively search file tree for files in matching folders
 * @param folderPaths - Array of folder path prefixes to match (e.g., ['research/youtube/lenny'])
 */
function searchTreeForKeywords(
  nodes: FileNode[],
  folderPaths: string[],
  matches: string[] = []
): string[] {
  for (const node of nodes) {
    const pathLower = node.path.toLowerCase();

    // Check if file is in one of the target folders
    for (const folderPath of folderPaths) {
      if (pathLower.startsWith(folderPath.toLowerCase())) {
        if (node.type === 'file' && node.name.endsWith('.md')) {
          matches.push(node.path);
        }
        break; // Don't add same file twice
      }
    }

    // Recurse into directories
    if (node.type === 'dir' && node.children) {
      searchTreeForKeywords(node.children, folderPaths, matches);
    }
  }

  return matches;
}

/**
 * Find files in the tree that might be relevant to a user's query
 * Returns file paths that match keywords in the query
 */
export function findRelevantFiles(
  query: string,
  tree: FileNode[],
  maxFiles: number = 5
): string[] {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const matches = searchTreeForKeywords(tree, keywords);

  // Check if user wants recent/latest files
  const queryLower = query.toLowerCase();
  const wantsRecent = queryLower.includes('recent') ||
                      queryLower.includes('latest') ||
                      queryLower.includes('newest') ||
                      queryLower.includes('most recent') ||
                      queryLower.includes('last');

  // Sort by relevance (more keyword matches = higher priority)
  const scored = matches.map(path => {
    const pathLower = path.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      if (pathLower.includes(keyword)) score++;
    }
    // Extract date for sorting
    const date = extractDateFromPath(path);
    return { path, score, date };
  });

  if (wantsRecent) {
    // Sort by date first (newest), then by keyword score
    scored.sort((a, b) => {
      if (b.date !== a.date) return b.date - a.date; // Newest first
      return b.score - a.score;
    });
  } else {
    // Sort by keyword relevance first, then by date (newest)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.date - a.date;
    });
  }

  return scored.slice(0, maxFiles).map(s => s.path);
}

// ============================================================================
// SAVE TO INBOX
// ============================================================================

export async function saveToInbox(content: string, filename?: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const response = await fetch('/api/inbox/save-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        timezone,
        filename, // Optional custom filename
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || 'Failed to save' };
    }

    const data = await response.json();
    return { success: true, path: data.path };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to save' };
  }
}
