"use client";

import { useState, useEffect } from "react";
import { X, Loader2, ExternalLink, Eye, EyeOff, Check, AlertCircle, Trash2 } from "lucide-react";
import {
  setApiKey,
  getApiKey,
  clearApiKey,
  validateApiKey,
  PROVIDERS,
  getAllProviders,
  type Provider,
} from "@/lib/brain-chat";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  provider?: Provider;
  existingKey?: boolean;
}

// Helper to mask an API key for display
function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  const prefix = key.slice(0, 7);
  const suffix = key.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function ApiKeyModal({ isOpen, onClose, onSuccess, provider: initialProvider, existingKey }: ApiKeyModalProps) {
  const [activeProvider, setActiveProvider] = useState<Provider>(initialProvider || 'anthropic');
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState("");

  // Get existing key for the active provider
  const existingApiKey = getApiKey(activeProvider);
  const hasExistingKey = !!existingApiKey;

  // Reset state when modal opens or provider changes
  useEffect(() => {
    if (isOpen) {
      setActiveProvider(initialProvider || 'anthropic');
      setKey("");
      setError("");
      setShowKey(false);
    }
  }, [isOpen, initialProvider]);

  if (!isOpen) return null;

  const providerConfig = PROVIDERS[activeProvider];
  const allProviders = getAllProviders();

  const handleProviderChange = (provider: Provider) => {
    setActiveProvider(provider);
    setKey("");
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError("Please enter your API key");
      return;
    }

    // Validate key format
    if (!trimmedKey.startsWith(providerConfig.keyPrefix)) {
      setError(`API key should start with '${providerConfig.keyPrefix}'`);
      return;
    }

    setIsValidating(true);
    setError("");

    const result = await validateApiKey(trimmedKey, activeProvider);

    if (result.valid) {
      setApiKey(trimmedKey, activeProvider);
      onSuccess();
      onClose();
    } else {
      setError(result.error || "Invalid API key");
    }

    setIsValidating(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {hasExistingKey ? "Update API Key" : "Add API Key"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Provider Tabs */}
        <div className="flex border-b border-gray-100">
          {allProviders.map((provider) => {
            const providerHasKey = !!getApiKey(provider);
            return (
              <button
                key={provider}
                onClick={() => handleProviderChange(provider)}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  activeProvider === provider
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {PROVIDERS[provider].name}
                {providerHasKey && (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-4">
              {hasExistingKey
                ? `Update your ${providerConfig.name} API key. Your key is stored locally in your browser.`
                : `Enter your ${providerConfig.name} API key. Your key is stored locally in your browser and never sent to our servers.`
              }
            </p>

            {/* Show existing key if one exists */}
            {hasExistingKey && existingApiKey && (
              <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs text-green-700 font-medium mb-1">Current key:</p>
                  <p className="text-sm text-green-800 font-mono">{maskApiKey(existingApiKey)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearApiKey(activeProvider);
                    onSuccess(); // Refresh parent state
                  }}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Delete this API key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">
              {hasExistingKey ? 'New API Key' : 'API Key'}
            </label>
            <div className="relative">
              <input
                id="api-key"
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setError("");
                }}
                placeholder={providerConfig.placeholder}
                className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                autoComplete="off"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {error}
              </p>
            )}
          </div>

          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              <strong>Get your API key:</strong>{" "}
              <a
                href={providerConfig.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline inline-flex items-center gap-1"
              >
                {providerConfig.consoleUrl.replace('https://', '').split('/')[0]}
                <ExternalLink className="w-3 h-3" />
              </a>
            </p>
            <p className="text-xs text-blue-600 mt-1">
              {providerConfig.helpText}
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isValidating || !key.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {hasExistingKey ? 'Update Key' : 'Save Key'}
                </>
              )}
            </button>
          </div>
        </form>

        {/* Security note */}
        <div className="px-4 pb-4">
          <p className="text-xs text-gray-500 text-center">
            Your API key is stored only in this browser's local storage.
            It's used to call {providerConfig.name} directly from your device.
          </p>
        </div>
      </div>
    </div>
  );
}
