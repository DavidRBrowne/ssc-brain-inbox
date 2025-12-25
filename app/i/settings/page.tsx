"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, LogOut, RefreshCw, FolderOpen, Check, Key, Trash2, ExternalLink, ChevronDown } from "lucide-react";
import Link from "next/link";
import {
  getApiKey,
  clearApiKey,
  getActiveProvider,
  setActiveProvider,
  getProvidersWithStatus,
  hasApiKey,
  PROVIDERS,
  runMigration,
  type Provider,
} from "@/lib/brain-chat";
import { ApiKeyModal } from "../chat/components/api-key-modal";

const APP_VERSION = "0.4.0";

interface Folder {
  name: string;
  path: string;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [settings, setSettings] = useState<{
    username: string;
    repo: string;
    inboxPath: string;
    connected: boolean;
  } | null>(null);

  // Folder selection state
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);

  // Provider state
  const [activeProvider, setActiveProviderState] = useState<Provider>('anthropic');
  const [providerStatus, setProviderStatus] = useState<Array<{
    config: typeof PROVIDERS[Provider];
    hasKey: boolean;
    isActive: boolean;
  }>>([]);
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);

  // API key modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [modalProvider, setModalProvider] = useState<Provider>('anthropic');

  useEffect(() => {
    // Run migration on first load
    runMigration();

    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/inbox/status");
        const data = await response.json();
        setSettings({
          username: data.githubUsername || "",
          repo: data.githubRepo || "",
          inboxPath: data.inboxPath || "!inbox",
          connected: data.githubConnected || false,
        });

        // Load provider status
        setActiveProviderState(getActiveProvider());
        setProviderStatus(getProvidersWithStatus());
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleClearApiKey = (provider: Provider) => {
    if (!confirm(`Remove your ${PROVIDERS[provider].name} API key? You'll need to add it again to use this provider.`)) {
      return;
    }
    clearApiKey(provider);
    setProviderStatus(getProvidersWithStatus());
  };

  const handleProviderChange = (provider: Provider) => {
    // Only allow switching to providers with keys
    if (!hasApiKey(provider)) {
      // Open modal to add key
      setModalProvider(provider);
      setShowApiKeyModal(true);
      return;
    }
    setActiveProvider(provider);
    setActiveProviderState(provider);
    setProviderStatus(getProvidersWithStatus());
    setShowProviderDropdown(false);
  };

  const handleOpenKeyModal = (provider: Provider) => {
    setModalProvider(provider);
    setShowApiKeyModal(true);
  };

  const handleKeyModalSuccess = () => {
    // Refresh provider status
    setProviderStatus(getProvidersWithStatus());
    // If this is the first key, set it as active
    const newStatus = getProvidersWithStatus();
    const hasAnyKey = newStatus.some(p => p.hasKey);
    if (hasAnyKey && !hasApiKey(activeProvider)) {
      const firstWithKey = newStatus.find(p => p.hasKey);
      if (firstWithKey) {
        setActiveProvider(firstWithKey.config.id);
        setActiveProviderState(firstWithKey.config.id);
      }
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect from GitHub? You'll need to reconnect to save notes.")) {
      return;
    }

    setDisconnecting(true);
    try {
      await fetch("/api/inbox/auth/disconnect", { method: "POST" });
      window.location.href = "/i";
    } catch (error) {
      console.error("Failed to disconnect:", error);
      setDisconnecting(false);
    }
  };

  const handleChangeRepo = async () => {
    try {
      await fetch("/api/inbox/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearRepo: true }),
      });
      window.location.href = "/i";
    } catch (error) {
      console.error("Failed to clear repo:", error);
    }
  };

  const fetchFolders = async () => {
    if (!settings?.repo) return;

    setLoadingFolders(true);
    try {
      const response = await fetch(`/api/inbox/folders?repo=${encodeURIComponent(settings.repo)}`);
      const data = await response.json();
      if (data.folders) {
        setFolders(data.folders);
      } else if (data.error) {
        console.error("Folder fetch error:", data.error);
      }
    } catch (error) {
      console.error("Failed to fetch folders:", error);
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleChangeFolder = async () => {
    setShowFolderPicker(true);
    await fetchFolders();
  };

  const handleSelectFolder = async (folderPath: string) => {
    setSavingFolder(true);
    try {
      await fetch("/api/inbox/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: settings?.repo, inboxPath: folderPath }),
      });

      setSettings(prev => prev ? { ...prev, inboxPath: folderPath } : null);
      setShowFolderPicker(false);
    } catch (error) {
      console.error("Failed to save folder:", error);
    } finally {
      setSavingFolder(false);
    }
  };

  // Get providers that have keys for the dropdown
  const providersWithKeys = providerStatus.filter(p => p.hasKey);
  const currentProviderConfig = PROVIDERS[activeProvider];

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center gap-4 px-4 py-3 border-b border-gray-100">
        <Link
          href="/i"
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
      </header>

      <div className="max-w-md mx-auto px-4 py-8">
        {settings?.connected ? (
          <div className="space-y-6">
            {/* GitHub Connection */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h2 className="font-medium text-gray-900 mb-3">GitHub Connection</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Account</span>
                  <span className="font-medium text-gray-900">{settings.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Repository</span>
                  <span className="font-medium text-gray-900">{settings.repo}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Inbox folder</span>
                  <span className="font-medium text-gray-900">{settings.inboxPath}</span>
                </div>
              </div>
            </div>

            {/* Folder Picker Modal */}
            {showFolderPicker && (
              <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-lg">
                <h3 className="font-medium text-gray-900 mb-3">Select Inbox Folder</h3>
                {loadingFolders ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
                  </div>
                ) : folders.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    <p className="mb-2">No folders found in this repository.</p>
                    <p>Notes will be saved to the root of the repository, or you can keep using <strong>{settings.inboxPath}</strong> (folder will be created automatically).</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {folders.map((folder) => (
                      <button
                        key={folder.path}
                        onClick={() => handleSelectFolder(folder.path)}
                        disabled={savingFolder}
                        className={`w-full p-3 text-left border rounded-lg transition-colors flex items-center gap-2 ${
                          folder.path === settings.inboxPath
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:border-blue-500 hover:bg-blue-50"
                        }`}
                      >
                        <FolderOpen className="w-4 h-4 text-gray-400" />
                        <span className="flex-1 text-gray-900">{folder.name}</span>
                        {folder.path === settings.inboxPath && (
                          <Check className="w-4 h-4 text-blue-600" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setShowFolderPicker(false)}
                  className="mt-3 w-full py-2 text-gray-600 text-sm hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Chat with Brain Section */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h2 className="font-medium text-gray-900 mb-3">Chat with Brain</h2>

              {/* Active Provider Selector */}
              <div className="mb-4">
                <label className="block text-sm text-gray-600 mb-1">Active Provider</label>
                <div className="relative">
                  <button
                    onClick={() => setShowProviderDropdown(!showProviderDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                  >
                    <span>{currentProviderConfig.name}</span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showProviderDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showProviderDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                      {providerStatus.map((provider) => (
                        <button
                          key={provider.config.id}
                          onClick={() => handleProviderChange(provider.config.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg ${
                            provider.isActive ? 'bg-blue-50' : ''
                          }`}
                        >
                          <span className="font-medium text-gray-900">
                            {provider.config.name}
                            {!provider.hasKey && <span className="text-gray-400 font-normal ml-1">(no key)</span>}
                          </span>
                          {provider.isActive && <Check className="w-4 h-4 text-blue-600" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* API Keys List */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-600">API Keys</label>
                {providerStatus.map((provider) => (
                  <div
                    key={provider.config.id}
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">{provider.config.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        provider.hasKey
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {provider.hasKey ? 'Configured' : 'Not set'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenKeyModal(provider.config.id)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                      >
                        {provider.hasKey ? 'Update' : 'Add Key'}
                      </button>
                      {provider.hasKey && (
                        <button
                          onClick={() => handleClearApiKey(provider.config.id)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Remove key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Info text */}
              <p className="mt-3 text-xs text-gray-500">
                Keys stored locally in this browser.
              </p>

              {/* Usage links */}
              <div className="mt-2 flex flex-wrap gap-2">
                {providerStatus.filter(p => p.hasKey).map((provider) => (
                  <a
                    key={provider.config.id}
                    href={provider.config.usageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    {provider.config.name}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                onClick={handleChangeFolder}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Change Inbox Folder
              </button>

              <button
                onClick={handleChangeRepo}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Change Repository
              </button>

              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {disconnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                Disconnect GitHub
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4">Not connected to GitHub</p>
            <Link
              href="/i"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Connect GitHub
            </Link>
          </div>
        )}

        {/* Version */}
        <p className="text-center text-xs text-gray-400 mt-8">v{APP_VERSION}</p>
      </div>

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        onSuccess={handleKeyModalSuccess}
        provider={modalProvider}
        existingKey={hasApiKey(modalProvider)}
      />
    </div>
  );
}
