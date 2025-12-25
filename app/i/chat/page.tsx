"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowUp, Loader2, Settings, FolderTree, Save, Trash2, X, Globe, Code, Plus, Info, ChevronDown, Check } from "lucide-react";
import Link from "next/link";
import {
  getApiKey,
  clearApiKey,
  ChatMessage,
  LoadedFile,
  FileNode,
  fetchFileTree,
  loadFileContents,
  buildSystemPrompt,
  sendMessage,
  saveToInbox,
  getContextStatus,
  getSelectedModel,
  setSelectedModel,
  findRelevantFiles,
  getWebSearchEnabled,
  setWebSearchEnabled,
  getWebFetchEnabled,
  setWebFetchEnabled,
  getCodeExecutionEnabled,
  setCodeExecutionEnabled,
  UsageData,
  getActiveProvider,
  setActiveProvider,
  getActiveProviderModels,
  getAllProviders,
  getModelsForProvider,
  PROVIDERS,
  runMigration,
  type Provider,
  type ModelDefinition,
} from "@/lib/brain-chat";
import { formatMarkdown } from "@/lib/format-markdown";
import { ApiKeyModal } from "./components/api-key-modal";
import { FileBrowser } from "./components/file-browser";
import { MarkdownContent } from "./components/markdown-content";
import packageJson from "@/package.json";

const APP_VERSION = packageJson.version;

// Tool result types for dismissible status
interface ToolResult {
  type: 'search' | 'fetch' | 'code';
  status: 'loading' | 'success' | 'error';
  message: string;
  count?: number;
}

// Default files to load on startup
const DEFAULT_FILES = ["CLAUDE.md"];

export default function ChatPage() {
  // State
  const [connectionState, setConnectionState] = useState<"loading" | "no-github" | "no-api-key" | "ready">("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  // Files
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // UI
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [modalProvider, setModalProvider] = useState<Provider | undefined>(undefined);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [savingMessage, setSavingMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [autoLoadingFiles, setAutoLoadingFiles] = useState<string[] | null>(null);

  // Provider state
  const [activeProvider, setActiveProviderState] = useState<Provider>('anthropic');
  const [availableModels, setAvailableModels] = useState<ModelDefinition[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);

  // Tools
  const [webSearchEnabled, setWebSearchEnabledState] = useState(false);
  const [webFetchEnabled, setWebFetchEnabledState] = useState(false);
  const [codeExecutionEnabled, setCodeExecutionEnabledState] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);

  // Cost tracking - accumulates for the session
  const [sessionCost, setSessionCost] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const providerDropdownRef = useRef<HTMLDivElement>(null);

  // Close provider dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(event.target as Node)) {
        setShowProviderDropdown(false);
      }
    };

    if (showProviderDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProviderDropdown]);

  // Scroll to bottom when messages change - but only for new messages, not during streaming
  const lastMessageCountRef = useRef(0);
  useEffect(() => {
    // Only auto-scroll when a new message is added, not during streaming updates
    if (messages.length > lastMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      lastMessageCountRef.current = messages.length;
    }
  }, [messages]);

  // Load provider, model, and tool preferences
  useEffect(() => {
    // Run migration on first load
    runMigration();

    const provider = getActiveProvider();
    setActiveProviderState(provider);

    const models = getActiveProviderModels();
    setAvailableModels(models);

    const savedModel = getSelectedModel();
    // Verify the saved model is valid for this provider
    if (models.some(m => m.id === savedModel)) {
      setSelectedModelId(savedModel);
    } else if (models.length > 0) {
      setSelectedModelId(models[0].id);
    }

    setWebSearchEnabledState(getWebSearchEnabled());
    setWebFetchEnabledState(getWebFetchEnabled());
    setCodeExecutionEnabledState(getCodeExecutionEnabled());
  }, []);

  // Check connection status on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        // Check GitHub connection
        const response = await fetch("/api/inbox/status");
        const data = await response.json();

        if (!data.githubConnected || !data.githubRepo) {
          setConnectionState("no-github");
          return;
        }

        // Check API key
        const apiKey = getApiKey();
        if (!apiKey) {
          setConnectionState("no-api-key");
          return;
        }

        setConnectionState("ready");

        // Load file tree
        const tree = await fetchFileTree();
        setFileTree(tree);

        // Auto-load default files
        await loadDefaultFiles();
      } catch (error) {
        console.error("Failed to check status:", error);
        setConnectionState("no-github");
      }
    };

    checkStatus();
  }, []);

  const loadDefaultFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const files = await loadFileContents(DEFAULT_FILES);
      setLoadedFiles(files.filter(f => !f.content.startsWith('[Error')));
    } catch (error) {
      console.error("Failed to load default files:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLoadFiles = async (paths: string[]) => {
    setIsLoadingFiles(true);
    try {
      const newFiles = await loadFileContents(paths);
      const validFiles = newFiles.filter(f => !f.content.startsWith('[Error'));

      setLoadedFiles(prev => {
        const existingPaths = new Set(prev.map(f => f.path));
        const toAdd = validFiles.filter(f => !existingPaths.has(f.path));
        return [...prev, ...toAdd];
      });
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleUnloadFile = useCallback((path: string) => {
    setLoadedFiles(prev => prev.filter(f => f.path !== path));
  }, []);

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    setSelectedModel(modelId);
  };

  const handleProviderChange = (provider: Provider) => {
    // Check if provider has an API key
    if (!getApiKey(provider)) {
      // Open modal to add key for this provider - on the correct tab
      setModalProvider(provider);
      setShowApiKeyModal(true);
      setShowProviderDropdown(false);
      return;
    }

    // Switch to the new provider
    setActiveProvider(provider);
    setActiveProviderState(provider);

    // Get models for the new provider
    const providerModels = getModelsForProvider(provider);
    setAvailableModels(providerModels);

    // Select the first model of the new provider
    if (providerModels.length > 0) {
      setSelectedModelId(providerModels[0].id);
      setSelectedModel(providerModels[0].id);
    }

    setShowProviderDropdown(false);
  };

  const handleWebSearchToggle = () => {
    const newValue = !webSearchEnabled;
    setWebSearchEnabledState(newValue);
    setWebSearchEnabled(newValue);
  };

  const handleWebFetchToggle = () => {
    const newValue = !webFetchEnabled;
    setWebFetchEnabledState(newValue);
    setWebFetchEnabled(newValue);
  };

  const handleCodeExecutionToggle = () => {
    const newValue = !codeExecutionEnabled;
    setCodeExecutionEnabledState(newValue);
    setCodeExecutionEnabled(newValue);
  };

  // Get provider capabilities
  const providerConfig = PROVIDERS[activeProvider];
  const supportsWebSearch = providerConfig?.supportsWebSearch ?? false;
  const supportsCodeExecution = providerConfig?.supportsCodeExecution ?? false;

  const handleSendMessage = async () => {
    const content = input.trim();
    if (!content || isStreaming) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setStreamingContent("");

    // Progressive disclosure: search for relevant files based on the query
    let currentLoadedFiles = loadedFiles;
    const relevantPaths = findRelevantFiles(content, fileTree, 3);
    const loadedPaths = new Set(loadedFiles.map(f => f.path));
    const newPaths = relevantPaths.filter(p => !loadedPaths.has(p));

    if (newPaths.length > 0) {
      setAutoLoadingFiles(newPaths);
      try {
        const newFiles = await loadFileContents(newPaths);
        const validFiles = newFiles.filter(f => !f.content.startsWith('[Error'));
        if (validFiles.length > 0) {
          currentLoadedFiles = [...loadedFiles, ...validFiles];
          setLoadedFiles(currentLoadedFiles);
        }
      } catch (error) {
        console.error("Failed to auto-load files:", error);
      }
      setAutoLoadingFiles(null);
    }

    // Prepare messages for API
    const apiMessages = [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Build system prompt with loaded files (including any just auto-loaded) and file tree
    // Only include tool options if the provider supports them
    const systemPrompt = buildSystemPrompt(currentLoadedFiles, fileTree, {
      enableWebSearch: webSearchEnabled && supportsWebSearch,
      enableWebFetch: webFetchEnabled,
      enableCodeExecution: codeExecutionEnabled && supportsCodeExecution,
    });

    // Send message with streaming
    await sendMessage(apiMessages, systemPrompt, apiKey, {
      onStart: () => {
        setIsStreaming(true);
        setStreamingContent("");
        setToolStatus(null);
        setToolResults([]);
      },
      onToken: (token) => {
        setStreamingContent(prev => prev + token);
      },
      onWebSearch: (query) => {
        setToolStatus(`Searching: ${query}`);
      },
      onWebSearchResults: (resultCount) => {
        setToolStatus(null);
        setToolResults(prev => [...prev, {
          type: 'search',
          status: 'success',
          message: `Found ${resultCount} result${resultCount !== 1 ? 's' : ''}`,
          count: resultCount,
        }]);
      },
      onWebFetch: (url) => {
        setToolStatus(`Fetching: ${url}`);
      },
      onWebFetchComplete: () => {
        setToolStatus(null);
        setToolResults(prev => [...prev, {
          type: 'fetch',
          status: 'success',
          message: 'Page fetched',
        }]);
      },
      onCodeExecution: (status) => {
        setToolStatus(status);
      },
      onCodeExecutionComplete: () => {
        setToolStatus(null);
        setToolResults(prev => [...prev, {
          type: 'code',
          status: 'success',
          message: 'Code executed',
        }]);
      },
      onToolError: (toolName, errorMsg) => {
        setToolStatus(null);
        const typeMap: Record<string, 'search' | 'fetch' | 'code'> = {
          'web_search': 'search',
          'web_fetch': 'fetch',
          'code_execution': 'code',
        };
        setToolResults(prev => [...prev, {
          type: typeMap[toolName] || 'search',
          status: 'error',
          message: errorMsg,
        }]);
      },
      onUsage: (usage: UsageData) => {
        setSessionCost(prev => prev + usage.cost);
      },
      onComplete: (fullResponse) => {
        setIsStreaming(false);
        setToolStatus(null);
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: fullResponse,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent("");
        // Re-focus input after response
        setTimeout(() => inputRef.current?.focus(), 100);
      },
      onError: (error) => {
        setIsStreaming(false);
        setStreamingContent("");
        setToolStatus(null);

        // Check if it's an auth error
        if (error.includes("401") || error.includes("Invalid API key")) {
          clearApiKey();
          setShowApiKeyModal(true);
          return;
        }

        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        // Re-focus input after error
        setTimeout(() => inputRef.current?.focus(), 100);
      },
    }, selectedModelId, {
      enableWebSearch: webSearchEnabled && supportsWebSearch,
      enableWebFetch: webFetchEnabled,
      enableCodeExecution: codeExecutionEnabled && supportsCodeExecution,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSaveMessage = async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    setSavingMessage(messageId);
    setSaveStatus(null);

    const result = await saveToInbox(message.content);

    if (result.success) {
      setSaveStatus({ success: true, message: `Saved to ${result.path}` });
    } else {
      setSaveStatus({ success: false, message: result.error || "Failed to save" });
    }

    setSavingMessage(null);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleClearChat = async () => {
    if (messages.length === 0) return;
    setMessages([]);
    setSessionCost(0);
    setToolResults([]);
    // Reset loaded files back to just CLAUDE.md
    await loadDefaultFiles();
  };

  const handleApiKeySuccess = () => {
    // Refresh provider state
    const provider = getActiveProvider();
    setActiveProviderState(provider);
    const models = getActiveProviderModels();
    setAvailableModels(models);
    if (models.length > 0 && !models.some(m => m.id === selectedModelId)) {
      setSelectedModelId(models[0].id);
    }

    setConnectionState("ready");
    // Reload file tree if needed
    if (fileTree.length === 0) {
      fetchFileTree().then(setFileTree);
      loadDefaultFiles();
    }
  };

  // Loading state
  if (connectionState === "loading") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  // No GitHub connection
  if (connectionState === "no-github") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Connect GitHub First
          </h2>
          <p className="text-gray-600 mb-6">
            You need to connect your GitHub repository before you can chat with your brain.
          </p>
          <Link
            href="/i"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Go to Inbox Setup
          </Link>
        </div>
      </div>
    );
  }

  // No API key - show centered setup
  if (connectionState === "no-api-key") {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <Link
              href="/i"
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">Chat with Brain</h1>
          </div>
        </header>

        {/* Centered content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Add Your API Key to Start
            </h2>
            <p className="text-sm text-gray-500 max-w-md">
              To chat with your brain, add an API key for Anthropic, OpenAI, or Gemini. Your key stays in your browser - we never see it.
            </p>
            <p className="text-xs text-gray-400 mt-2 flex items-center justify-center gap-2">
              <span>Speak your language</span>
              <span className="flex gap-1">+22</span>
            </p>
          </div>
          <div className="w-full max-w-lg">
            <button
              onClick={() => setShowApiKeyModal(true)}
              className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-blue-600 text-white rounded-lg font-medium text-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              Add API Key to Continue
            </button>
            <p className="text-center text-xs text-gray-400 mt-4">
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-600"
              >
                Get API keys from Anthropic, OpenAI, or Google
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">v{APP_VERSION}</p>

        <ApiKeyModal
          isOpen={showApiKeyModal}
          onClose={() => {
            setShowApiKeyModal(false);
            setModalProvider(undefined);
          }}
          onSuccess={handleApiKeySuccess}
          provider={modalProvider}
        />
      </div>
    );
  }

  const contextStatus = getContextStatus(loadedFiles);
  const hasMessages = messages.length > 0 || isStreaming;

  // Ready - show chat
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
      {/* Header - sticky so controls are always visible */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/i"
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-semibold text-gray-900 hidden sm:block">Chat with Brain</h1>
          {/* Session cost display */}
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded" title="Session cost">
            ${sessionCost.toFixed(4)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* New Chat button - prominent when there are messages */}
          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="flex items-center gap-1 px-3 py-1.5 mr-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-colors"
              title="Start new chat"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New</span>
            </button>
          )}
          {/* Provider Dropdown */}
          <div className="relative mr-1" ref={providerDropdownRef}>
            <button
              onClick={() => setShowProviderDropdown(!showProviderDropdown)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {providerConfig?.name}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showProviderDropdown && (
              <div className="absolute top-full right-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                {getAllProviders().map((provider) => {
                  const config = PROVIDERS[provider];
                  const hasKey = !!getApiKey(provider);
                  return (
                    <button
                      key={provider}
                      onClick={() => handleProviderChange(provider)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                        activeProvider === provider
                          ? 'bg-blue-50 font-medium text-blue-700'
                          : hasKey
                            ? 'hover:bg-gray-100 text-gray-700'
                            : 'text-gray-400 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {config.name}
                        {hasKey && activeProvider !== provider && (
                          <Check className="w-3 h-3 text-green-500" />
                        )}
                      </span>
                      {!hasKey && (
                        <span className="text-[10px] text-gray-400">+ Add key</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* Model Switcher */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mr-1">
            {availableModels.map((model) => (
              <button
                key={model.id}
                onClick={() => handleModelChange(model.id)}
                className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  selectedModelId === model.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title={`${model.displayName} - $${model.inputCostPerMillion}/$${model.outputCostPerMillion} per M tokens`}
              >
                {model.displayName}
              </button>
            ))}
          </div>
          {/* Tool Toggles - only show if provider supports them */}
          {supportsWebSearch ? (
            <button
              onClick={handleWebSearchToggle}
              className={`p-2 rounded-lg transition-colors ${
                webSearchEnabled
                  ? 'bg-purple-100 text-purple-600'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title={webSearchEnabled ? 'Web search enabled' : 'Enable web search ($0.01/search)'}
            >
              <Globe className="w-5 h-5" />
            </button>
          ) : null}
          {supportsCodeExecution ? (
            <button
              onClick={handleCodeExecutionToggle}
              className={`p-2 rounded-lg transition-colors ${
                codeExecutionEnabled
                  ? 'bg-orange-100 text-orange-600'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title={codeExecutionEnabled ? 'Code execution enabled (beta)' : 'Enable code execution (beta)'}
            >
              <Code className="w-5 h-5" />
            </button>
          ) : null}
          <button
            onClick={() => setShowFileBrowser(!showFileBrowser)}
            className={`p-2 rounded-lg transition-colors ${
              showFileBrowser ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            title="Browse files"
          >
            <FolderTree className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="API key settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File browser - always visible on desktop, slide-over on mobile */}
        {/* Mobile: slide-over when showFileBrowser is true */}
        {showFileBrowser && (
          <div
            className="fixed inset-0 bg-black/30 z-40 md:hidden"
            onClick={() => setShowFileBrowser(false)}
          />
        )}
        {/* Desktop: always visible sidebar / Mobile: slide-over */}
        <div className={`
          ${showFileBrowser ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          fixed top-0 bottom-0 left-0 w-72 z-50
          md:relative md:z-auto md:block
          overflow-hidden flex flex-col border-r border-gray-200 bg-white shadow-lg md:shadow-none
          pb-[env(safe-area-inset-bottom)]
          transition-transform duration-200 ease-in-out
        `}>
          {/* Mobile close button */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 md:hidden">
            <span className="font-medium text-gray-900">Files</span>
            <button
              onClick={() => setShowFileBrowser(false)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <FileBrowser
            tree={fileTree}
            loadedFiles={loadedFiles}
            onLoadFiles={handleLoadFiles}
            onUnloadFile={handleUnloadFile}
            isLoading={isLoadingFiles}
          />
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Empty state - centered input */}
          {!hasMessages ? (
            <div className="flex-1 flex flex-col items-center justify-center px-4">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  Chat with your Brain
                </h2>
                <p className="text-sm text-gray-500 max-w-md">
                  Ask questions about your notes, research, and documentation.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Using {providerConfig?.name}
                </p>
              </div>

              {/* Input container - Claude style */}
              <div className="w-full max-w-2xl">
                <div className="relative bg-white rounded-xl border border-gray-200 shadow-sm">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your brain files..."
                    className="w-full min-h-[100px] max-h-[200px] px-4 pt-4 pb-14 bg-transparent rounded-xl resize-none focus:outline-none text-gray-900 placeholder-gray-400"
                    rows={3}
                    disabled={contextStatus.isOverLimit}
                    autoFocus
                  />
                  {/* Bottom bar inside input */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setShowFileBrowser(!showFileBrowser)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          showFileBrowser ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                        }`}
                        title="Browse files"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setShowApiKeyModal(true)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Settings"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={handleSendMessage}
                      disabled={!input.trim() || contextStatus.isOverLimit}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-100 disabled:text-gray-300"
                      style={{
                        backgroundColor: input.trim() && !contextStatus.isOverLimit ? '#C45A2C' : undefined,
                        color: input.trim() && !contextStatus.isOverLimit ? 'white' : undefined,
                      }}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Tool toggles below input - only for Anthropic */}
                {supportsWebSearch || supportsCodeExecution ? (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    {supportsWebSearch && (
                      <button
                        onClick={handleWebSearchToggle}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          webSearchEnabled
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        Search
                      </button>
                    )}
                    {supportsCodeExecution && (
                      <button
                        onClick={handleCodeExecutionToggle}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          codeExecutionEnabled
                            ? 'bg-orange-100 text-orange-700 border border-orange-200'
                            : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        <Code className="w-3.5 h-3.5" />
                        Code
                      </button>
                    )}
                  </div>
                ) : null}

                {/* Context status */}
                <p className={`text-xs mt-3 text-center ${
                  contextStatus.isOverLimit
                    ? 'text-red-600'
                    : contextStatus.isWarning
                    ? 'text-amber-600'
                    : 'text-gray-400'
                }`}>
                  {loadedFiles.length === 0
                    ? 'No files loaded - click + to add context'
                    : `${loadedFiles.length} file${loadedFiles.length > 1 ? 's' : ''} loaded (${contextStatus.message})`
                  }
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Context status bar */}
              <div className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
                contextStatus.isOverLimit
                  ? 'bg-red-50 text-red-700 border-red-100'
                  : contextStatus.isWarning
                  ? 'bg-amber-50 text-amber-700 border-amber-100'
                  : 'bg-white text-gray-600 border-gray-100'
              }`}>
                <span className="flex items-center gap-2">
                  {loadedFiles.length === 0
                    ? 'No files loaded - tap the folder icon to load files'
                    : `${loadedFiles.length} file${loadedFiles.length > 1 ? 's' : ''} loaded`
                  }
                  {webSearchEnabled && supportsWebSearch && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                      <Globe className="w-3 h-3" />
                      Search
                    </span>
                  )}
                  {codeExecutionEnabled && supportsCodeExecution && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                      <Code className="w-3 h-3" />
                      Code
                    </span>
                  )}
                </span>
                <span>{contextStatus.message}</span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`w-full px-4 py-4 ${
                      message.role === 'user' ? 'bg-gray-50' : 'bg-white'
                    }`}
                  >
                    <div className="max-w-3xl mx-auto">
                      <div className="text-xs font-medium text-gray-500 mb-2">
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </div>
                      {message.role === 'user' ? (
                        <div className="text-sm text-gray-900 whitespace-pre-wrap">
                          {message.content}
                        </div>
                      ) : (
                        <MarkdownContent
                          html={formatMarkdown(message.content)}
                          className="prose prose-sm max-w-none text-gray-900"
                        />
                      )}
                      {message.role === 'assistant' && (
                        <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-3">
                          <button
                            onClick={() => handleSaveMessage(message.id)}
                            disabled={savingMessage === message.id}
                            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                          >
                            {savingMessage === message.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            Save to inbox
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Auto-loading files indicator */}
                {autoLoadingFiles && (
                  <div className="w-full px-4 py-3 bg-blue-50 border-b border-blue-100">
                    <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-blue-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Loading relevant files: {autoLoadingFiles.join(', ')}</span>
                    </div>
                  </div>
                )}

                {/* Tool status indicator (in progress) */}
                {toolStatus && (
                  <div className="w-full px-4 py-3 bg-purple-50 border-b border-purple-100">
                    <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-purple-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{toolStatus}</span>
                    </div>
                  </div>
                )}

                {/* Tool results (dismissible) */}
                {toolResults.length > 0 && (
                  <div className="w-full px-4 py-2 border-b border-gray-100 bg-gray-50">
                    <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-2">
                      {toolResults.map((result, idx) => {
                        const bgColor = result.status === 'error'
                          ? 'bg-red-100 text-red-700'
                          : result.type === 'search'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-orange-100 text-orange-700';
                        const Icon = result.type === 'search' ? Globe : Code;
                        return (
                          <div
                            key={idx}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${bgColor}`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{result.message}</span>
                            <button
                              onClick={() => setToolResults(prev => prev.filter((_, i) => i !== idx))}
                              className="ml-0.5 hover:opacity-70"
                              title="Dismiss"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                      {toolResults.length > 1 && (
                        <button
                          onClick={() => setToolResults([])}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Streaming message */}
                {isStreaming && (
                  <div className="w-full px-4 py-4 bg-white">
                    <div className="max-w-3xl mx-auto">
                      <div className="text-xs font-medium text-gray-500 mb-2">
                        Assistant
                      </div>
                      {streamingContent ? (
                        <MarkdownContent
                          html={formatMarkdown(streamingContent)}
                          className="prose prose-sm max-w-none text-gray-900"
                        />
                      ) : (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Save status toast */}
              {saveStatus && (
                <div className={`mx-4 mb-2 px-4 py-2 rounded-lg text-sm ${
                  saveStatus.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {saveStatus.message}
                </div>
              )}

              {/* Input - bottom */}
              <div className="border-t border-gray-100 bg-white px-4 py-3">
                <div className="max-w-3xl mx-auto">
                  <div className="relative bg-gray-50 rounded-xl border border-gray-200">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={isStreaming ? "Assistant is responding..." : "Type your message..."}
                      className="w-full min-h-[56px] max-h-[200px] px-4 pt-3 pb-12 bg-transparent rounded-xl resize-none focus:outline-none text-gray-900 placeholder-gray-400"
                      rows={1}
                      disabled={isStreaming || contextStatus.isOverLimit}
                    />
                    {/* Bottom bar inside input */}
                    <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setShowFileBrowser(!showFileBrowser)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            showFileBrowser ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
                          }`}
                          title="Browse files"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        {supportsWebSearch && (
                          <button
                            onClick={handleWebSearchToggle}
                            className={`p-1.5 rounded-lg transition-colors ${
                              webSearchEnabled
                                ? 'bg-purple-100 text-purple-600'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
                            }`}
                            title={webSearchEnabled ? 'Web search enabled' : 'Enable web search'}
                          >
                            <Globe className="w-4 h-4" />
                          </button>
                        )}
                        {supportsCodeExecution && (
                          <button
                            onClick={handleCodeExecutionToggle}
                            className={`p-1.5 rounded-lg transition-colors ${
                              codeExecutionEnabled
                                ? 'bg-orange-100 text-orange-600'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
                            }`}
                            title={codeExecutionEnabled ? 'Code execution enabled' : 'Enable code execution'}
                          >
                            <Code className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <button
                        onClick={handleSendMessage}
                        disabled={!input.trim() || isStreaming || contextStatus.isOverLimit}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-200 disabled:text-gray-400"
                        style={{
                          backgroundColor: input.trim() && !isStreaming && !contextStatus.isOverLimit ? '#C45A2C' : undefined,
                          color: input.trim() && !isStreaming && !contextStatus.isOverLimit ? 'white' : undefined,
                        }}
                      >
                        {isStreaming ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ArrowUp className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="px-4 pb-2 text-center bg-[#F9FAFB]">
            <p className="text-xs text-gray-400">v{APP_VERSION}</p>
          </div>
        </div>
      </div>

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={showApiKeyModal}
        onClose={() => {
          setShowApiKeyModal(false);
          setModalProvider(undefined);
        }}
        onSuccess={handleApiKeySuccess}
        provider={modalProvider}
      />
    </div>
  );
}
