"use client";

import { useState, useEffect, useCallback } from "react";
import { Github, ExternalLink, Loader2, Check, Copy, Share, Plus, FolderOpen, X, HelpCircle } from "lucide-react";
import Link from "next/link";
import packageJson from "../../package.json";

// Version from package.json
const APP_VERSION = packageJson.version;

// Detect if user is on mobile device
const getIsMobile = () => {
  if (typeof window === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
};

type ConnectionState = "loading" | "disconnected" | "connecting" | "select-repo" | "select-folder" | "test-save" | "add-to-home" | "connected";

interface Repo {
  name: string;
  fullName: string;
  private: boolean;
  isTemplate?: boolean;
}

interface Folder {
  name: string;
  path: string;
}

export default function InboxPage() {
  const [textContent, setTextContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // GitHub connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [selectedFolder, setSelectedFolder] = useState<string>("!inbox");

  // Device flow state
  const [userCode, setUserCode] = useState<string>("");
  const [verificationUri, setVerificationUri] = useState<string>("");
  const [deviceCode, setDeviceCode] = useState<string>("");
  const [pollInterval, setPollInterval] = useState<number>(5);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);

  // Repo/folder selection state
  const [repos, setRepos] = useState<Repo[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [customFolder, setCustomFolder] = useState("");
  const [showCustomFolder, setShowCustomFolder] = useState(false);

  // Onboarding state
  const [isNewSetup, setIsNewSetup] = useState(false);
  const [testCompleted, setTestCompleted] = useState(false);
  const [showSetupHint, setShowSetupHint] = useState(true);
  const [showTemplateWarning, setShowTemplateWarning] = useState(false);

  // Device detection
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile on mount
  useEffect(() => {
    setIsMobile(getIsMobile());
  }, []);

  // Check connection status on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch("/api/inbox/status");
        const data = await response.json();

        if (data.githubConnected && data.githubUsername) {
          setGithubUsername(data.githubUsername);
          if (data.githubRepo) {
            setSelectedRepo(data.githubRepo);
            setSelectedFolder(data.inboxPath || "!inbox");
            setConnectionState("connected");
          } else {
            setConnectionState("select-repo");
            fetchRepos();
          }
        } else {
          setConnectionState("disconnected");
        }
      } catch {
        setConnectionState("disconnected");
      }
    };

    checkStatus();
  }, []);

  // Fetch user's repos
  const fetchRepos = async () => {
    setLoadingRepos(true);
    try {
      const response = await fetch("/api/inbox/repos");
      const data = await response.json();
      if (data.repos) {
        setRepos(data.repos);
      }
    } catch (error) {
      console.error("Failed to fetch repos:", error);
    } finally {
      setLoadingRepos(false);
    }
  };

  // Fetch folders in selected repo
  // repoFullName is owner/repo format (e.g., "mikerhodes/brain")
  const fetchFolders = async (repoName: string, repoFullName?: string) => {
    setLoadingFolders(true);
    try {
      // Use full name if available for proper owner resolution
      const repoParam = repoFullName || repoName;
      const response = await fetch(`/api/inbox/folders?repo=${encodeURIComponent(repoParam)}`);
      const data = await response.json();
      if (data.folders) {
        setFolders(data.folders);
        // Check if !inbox exists
        const hasInbox = data.folders.some((f: Folder) => f.name === "!inbox");
        if (hasInbox) {
          setSelectedFolder("!inbox");
        }
      }
    } catch (error) {
      console.error("Failed to fetch folders:", error);
      setFolders([]);
    } finally {
      setLoadingFolders(false);
    }
  };

  // Start device flow
  const startDeviceFlow = async () => {
    setConnectionState("connecting");
    setErrorMessage("");
    setIsNewSetup(true);

    try {
      const response = await fetch("/api/inbox/auth/device-code", {
        method: "POST",
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setDeviceCode(data.deviceCode);
      setPollInterval(data.interval || 5);

      // Try to copy code to clipboard
      copyToClipboard(data.userCode);
    } catch (error) {
      setConnectionState("disconnected");
      setErrorMessage(error instanceof Error ? error.message : "Failed to start connection");
    }
  };

  // Helper function to copy to clipboard with fallback
  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCodeCopied(true);
        return;
      }
    } catch {
      // Fall through to fallback
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      setCodeCopied(successful);
    } catch {
      setCodeCopied(false);
    }
  };

  // Poll for token
  const pollForToken = useCallback(async () => {
    if (!deviceCode) return;

    try {
      const response = await fetch("/api/inbox/auth/poll-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      });

      const data = await response.json();

      if (data.status === "success") {
        setGithubUsername(data.username);
        setConnectionState("select-repo");
        setDeviceCode("");
        setUserCode("");
        fetchRepos();
        return true;
      }

      if (data.status === "expired" || data.status === "denied") {
        setConnectionState("disconnected");
        setErrorMessage(data.status === "expired" ? "Code expired. Please try again." : "Access denied.");
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }, [deviceCode]);

  // Polling effect
  useEffect(() => {
    if (connectionState !== "connecting" || !deviceCode) return;

    const poll = async () => {
      const done = await pollForToken();
      if (!done) {
        setTimeout(poll, pollInterval * 1000);
      }
    };

    const timeout = setTimeout(poll, pollInterval * 1000);
    return () => clearTimeout(timeout);
  }, [connectionState, deviceCode, pollInterval, pollForToken]);

  // Save repo selection and move to folder selection
  // Now stores full path (owner/repo) to support collaborator repos
  // IMPORTANT: Save repo to cookies immediately so it persists even if folder selection fails
  const handleRepoSelection = async (repoFullName: string) => {
    setSelectedRepo(repoFullName);

    // Save repo to cookies immediately (don't wait for folder selection)
    try {
      await fetch("/api/inbox/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoFullName }),
      });
    } catch (error) {
      console.error("Failed to save repo selection:", error);
    }

    setConnectionState("select-folder");
    // Extract just the repo name for folder fetching (API will determine owner from repo data)
    const repoName = repoFullName.split('/').pop() || repoFullName;
    await fetchFolders(repoName, repoFullName);
  };

  // Save folder selection
  const handleFolderSelection = async (folderPath: string) => {
    try {
      await fetch("/api/inbox/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selectedRepo, inboxPath: folderPath }),
      });

      setSelectedFolder(folderPath);

      // If new setup, go to test step
      if (isNewSetup) {
        setConnectionState("test-save");
      } else {
        setConnectionState("connected");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  // Handle custom folder creation
  const handleCustomFolder = async () => {
    if (!customFolder.trim()) return;

    // Clean up the folder name
    let folderName = customFolder.trim();
    if (!folderName.startsWith("!")) {
      folderName = `!${folderName}`;
    }

    await handleFolderSelection(folderName);
  };

  // Save text note
  const handleTextSave = async () => {
    if (!textContent.trim()) return;

    setIsSaving(true);
    setSaveStatus("idle");
    setErrorMessage("");

    try {
      // Get user's timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const saveResponse = await fetch("/api/inbox/save-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: textContent, timezone }),
      });

      if (!saveResponse.ok) {
        const error = await saveResponse.json();

        if (error.code === "GITHUB_NOT_CONNECTED" || error.code === "TOKEN_EXPIRED") {
          setConnectionState("disconnected");
          throw new Error(error.code === "TOKEN_EXPIRED"
            ? "GitHub session expired. Please reconnect."
            : "Please connect GitHub first");
        }

        if (error.code === "NO_REPO_SELECTED") {
          setConnectionState("select-repo");
          fetchRepos();
          throw new Error("Please select a repository");
        }

        if (error.code === "REPO_NOT_FOUND") {
          setConnectionState("select-repo");
          fetchRepos();
          throw new Error(error.error || "Repository not found. Please select another.");
        }

        throw new Error(error.error || "Failed to save");
      }

      setSaveStatus("success");
      setTextContent("");

      // If in test mode, mark test as completed
      if (connectionState === "test-save") {
        setTestCompleted(true);
      }

      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  // Move to add-to-home step
  const proceedToAddHome = () => {
    setConnectionState("add-to-home");
  };

  // Complete onboarding
  const completeOnboarding = () => {
    setIsNewSetup(false);
    setConnectionState("connected");
  };

  // Loading state
  if (connectionState === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center relative">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        <p className="absolute bottom-4 text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    );
  }

  // Disconnected - show connect button
  if (connectionState === "disconnected") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 relative">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Github className="w-8 h-8 text-gray-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Connect GitHub
          </h2>
          <p className="text-gray-600 mb-6">
            Connect your GitHub account to save notes directly to your brain repository.
          </p>
          {errorMessage && (
            <p className="text-red-600 text-sm mb-4">{errorMessage}</p>
          )}
          <button
            onClick={startDeviceFlow}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            <Github className="w-5 h-5" />
            Connect GitHub
          </button>
        </div>
        <p className="absolute bottom-4 text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    );
  }

  // Connecting - show device code
  if (connectionState === "connecting" && userCode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 relative">
        <div className="text-center max-w-sm">
          {isNewSetup && (
            <p className="text-blue-600 text-sm font-medium mb-4">Step 1 of 3: Connect GitHub</p>
          )}
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Github className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Enter this code on GitHub
          </h2>
          <button
            onClick={() => copyToClipboard(userCode)}
            className="w-full bg-gray-100 rounded-lg p-4 mb-2 hover:bg-gray-200 transition-colors cursor-pointer"
          >
            <code className="text-2xl font-mono font-bold tracking-wider text-gray-900">
              {userCode}
            </code>
            <p className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1">
              {codeCopied ? (
                <>
                  <Check className="w-3 h-3 text-green-600" />
                  <span className="text-green-600">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Tap to copy
                </>
              )}
            </p>
          </button>
          <a
            href={verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors mb-4"
          >
            Open GitHub
            <ExternalLink className="w-4 h-4" />
          </a>
          <p className="text-gray-500 text-sm mb-2">
            Once you see the &quot;Congratulations!&quot; message, close that GitHub window and return here.
          </p>
          <p className="text-gray-400 text-xs mb-4">
            Note: GitHub may show a location like &quot;Council Bluffs&quot; - this is normal. It&apos;s where our server is located, not your device.
          </p>
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for authorization...
          </div>
        </div>
        <p className="absolute bottom-4 text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    );
  }

  // Select repo
  if (connectionState === "select-repo") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 relative">
        <div className="w-full max-w-md md:max-w-lg">
          {/* Setup hint card */}
          {showSetupHint && (
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 relative">
              <button
                onClick={() => setShowSetupHint(false)}
                className="absolute top-2 right-2 text-blue-400 hover:text-blue-600"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex gap-3">
                <HelpCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="pr-4">
                  <p className="text-sm text-blue-900 font-medium mb-1">
                    Don&apos;t see your brain repository?
                  </p>
                  <p className="text-sm text-blue-700 mb-2">
                    You need to set up your own brain repository first. This is where your notes will be saved.
                  </p>
                  <a
                    href="https://8020brain.com/setup"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    Go to Setup Guide
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {isNewSetup && (
            <p className="text-blue-600 text-sm font-medium mb-4 text-center">Step 1 of 3: Select Repository</p>
          )}
          <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">
            Select Repository
          </h2>
          <p className="text-gray-600 mb-6 text-center">
            Choose which repository to save notes to.
          </p>
          {loadingRepos ? (
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto" />
          ) : repos.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <p className="mb-3 font-medium text-gray-700">No brain repository found</p>
              <p className="text-sm mb-4">
                You need to create your own copy of the brain template first.
                Follow the setup guide to clone the template to your GitHub account.
              </p>
              <a
                href="https://8020brain.com/setup"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Go to Setup Guide
                <ExternalLink className="w-4 h-4" />
              </a>
              <p className="text-xs text-gray-400 mt-4">
                Already cloned? Try disconnecting and reconnecting GitHub.
              </p>
            </div>
          ) : (
            <>
              {/* Template Warning Modal */}
              {showTemplateWarning && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex gap-3">
                    <HelpCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-amber-900 font-medium mb-1">
                        This is the template repository
                      </p>
                      <p className="text-sm text-amber-700 mb-3">
                        You have read-only access to this repo. To use Brain Inbox, you need to create your own copy first.
                      </p>
                      <div className="flex gap-2">
                        <a
                          href="https://8020brain.com/setup"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 transition-colors"
                        >
                          Go to Setup Guide
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          onClick={() => setShowTemplateWarning(false)}
                          className="px-3 py-1.5 text-amber-700 text-sm hover:text-amber-900"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {repos.map((repo) => (
                  <button
                    key={repo.fullName}
                    onClick={() => {
                      if (repo.isTemplate) {
                        setShowTemplateWarning(true);
                      } else {
                        handleRepoSelection(repo.fullName);
                      }
                    }}
                    className={`w-full p-4 text-left border rounded-lg transition-colors ${
                      repo.isTemplate
                        ? "border-amber-200 bg-amber-50 hover:border-amber-300"
                        : "border-gray-200 hover:border-blue-500 hover:bg-blue-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${repo.isTemplate ? "text-amber-800" : "text-gray-900"}`}>
                        {repo.fullName}
                      </span>
                      <div className="flex gap-2">
                        {repo.isTemplate && (
                          <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
                            template (read-only)
                          </span>
                        )}
                        {repo.private && !repo.isTemplate && (
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            private
                          </span>
                        )}
                      </div>
                    </div>
                    {repo.isTemplate && (
                      <p className="text-xs text-amber-600 mt-1">
                        Clone this to create your own brain repository
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <p className="absolute bottom-4 text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    );
  }

  // Select folder
  if (connectionState === "select-folder") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 relative">
        <div className="w-full max-w-md md:max-w-lg">
          {isNewSetup && (
            <p className="text-blue-600 text-sm font-medium mb-4 text-center">Step 1 of 3: Select Folder</p>
          )}
          <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">
            Select Inbox Folder
          </h2>
          <p className="text-gray-600 mb-6 text-center">
            Choose which folder to save notes to in <span className="font-medium">{selectedRepo}</span>.
          </p>
          {loadingFolders ? (
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto" />
          ) : (
            <div className="space-y-2">
              {/* Show !inbox option prominently if it exists */}
              {folders.some(f => f.name === "!inbox") && (
                <button
                  onClick={() => handleFolderSelection("!inbox")}
                  className="w-full p-4 text-left border-2 border-blue-500 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-blue-600" />
                    <span className="font-medium text-gray-900">!inbox</span>
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">recommended</span>
                  </div>
                </button>
              )}

              {/* Show other folders */}
              <div className="max-h-48 overflow-y-auto space-y-2">
                {folders.filter(f => f.name !== "!inbox").map((folder) => (
                  <button
                    key={folder.path}
                    onClick={() => handleFolderSelection(folder.path)}
                    className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{folder.name}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Create new folder option */}
              {!showCustomFolder ? (
                <button
                  onClick={() => setShowCustomFolder(true)}
                  className="w-full p-3 text-left border border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-center gap-2 text-gray-600">
                    <Plus className="w-4 h-4" />
                    <span>Create new folder</span>
                  </div>
                </button>
              ) : (
                <div className="p-3 border border-gray-200 rounded-lg space-y-2">
                  <input
                    type="text"
                    value={customFolder}
                    onChange={(e) => setCustomFolder(e.target.value)}
                    placeholder="inbox"
                    className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <p className="text-xs text-gray-500">Will be created as: !{customFolder || "inbox"}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCustomFolder}
                      disabled={!customFolder.trim()}
                      className="flex-1 py-2 bg-blue-600 text-white rounded font-medium disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => {
                        setShowCustomFolder(false);
                        setCustomFolder("");
                      }}
                      className="px-4 py-2 border border-gray-200 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* No !inbox found message */}
              {!folders.some(f => f.name === "!inbox") && folders.length > 0 && (
                <p className="text-amber-600 text-sm text-center mt-4">
                  No !inbox folder found. Select an existing folder or create a new one.
                </p>
              )}
            </div>
          )}
        </div>
        <p className="absolute bottom-4 text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    );
  }

  // Test save step
  if (connectionState === "test-save") {
    return (
      <div className="flex-1 flex flex-col px-4 py-6">
        <div className="text-center mb-6">
          <p className="text-blue-600 text-sm font-medium mb-2">Step 2 of 3: Test Save</p>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {testCompleted ? "Test Successful!" : "Let's test it works"}
          </h2>
          <p className="text-gray-600">
            {testCompleted
              ? "Your note was saved to your repository."
              : "Type a quick test note and save it to make sure everything is connected."}
          </p>
          {testCompleted && (
            <a
              href={`https://github.com/${githubUsername}/${selectedRepo}/tree/main/${selectedFolder}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm mt-2"
            >
              View in GitHub
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-full max-w-md flex flex-col gap-4">
            {!testCompleted && (
              <>
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (textContent.trim() && !isSaving) {
                        handleTextSave();
                      }
                    }
                  }}
                  placeholder="Type a test note..."
                  className="w-full h-32 p-4 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 text-lg"
                  disabled={isSaving}
                  autoFocus
                />
                <button
                  onClick={handleTextSave}
                  disabled={!textContent.trim() || isSaving}
                  className={`w-full py-4 rounded-lg font-medium text-lg transition-colors ${
                    saveStatus === "success"
                      ? "bg-green-500 text-white"
                      : !textContent.trim() || isSaving
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]"
                  }`}
                >
                  {isSaving ? "Saving..." : saveStatus === "success" ? "Saved!" : "Save Test Note"}
                </button>
              </>
            )}
            {testCompleted && (
              <button
                onClick={proceedToAddHome}
                className="w-full py-4 rounded-lg font-medium text-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                Continue to Final Step
              </button>
            )}
            {saveStatus === "error" && (
              <p className="text-red-600 text-sm text-center">{errorMessage}</p>
            )}
          </div>
        </div>

        <div className="text-center pt-4">
          <p className="text-sm text-gray-500">
            Saving to {githubUsername}/{selectedRepo}/{selectedFolder}
          </p>
          <p className="text-xs text-gray-400 mt-2">v{APP_VERSION}</p>
        </div>
      </div>
    );
  }

  // Add to home screen step
  if (connectionState === "add-to-home") {
    const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 relative">
        <div className="text-center max-w-sm">
          <p className="text-blue-600 text-sm font-medium mb-4">Step 3 of 3: Add to Home Screen</p>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Almost done!
          </h2>
          <p className="text-gray-600 mb-6">
            Add Brain Inbox to your home screen for quick access.
          </p>

          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            {isIOS ? (
              <ol className="space-y-3 text-sm text-gray-700">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span>Tap the <Share className="w-4 h-4 inline text-blue-600" /> Share button at the bottom of Safari</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <span>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <span>Tap <strong>&quot;Add&quot;</strong> in the top right</span>
                </li>
              </ol>
            ) : isAndroid ? (
              <ol className="space-y-3 text-sm text-gray-700">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span>Tap the <strong>menu icon</strong> (three dots) in Chrome</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <span>Tap <strong>&quot;Add to Home screen&quot;</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <span>Tap <strong>&quot;Add&quot;</strong></span>
                </li>
              </ol>
            ) : (
              <p className="text-sm text-gray-600">
                On mobile, use your browser&apos;s &quot;Add to Home Screen&quot; option to create an app icon for quick access.
              </p>
            )}
          </div>

          <button
            onClick={completeOnboarding}
            className="w-full py-3 rounded-lg font-medium bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            Done - Start Using Brain Inbox
          </button>

          <button
            onClick={completeOnboarding}
            className="mt-3 text-gray-500 text-sm hover:text-gray-700"
          >
            Skip for now
          </button>
        </div>
        <p className="absolute bottom-4 text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    );
  }

  // Connected - show main UI
  const placeholderText = isMobile
    ? "Tap here, then use your keyboard's mic button to dictate..."
    : "Type your note here... (Cmd+Enter to save)";

  return (
    <div className="flex-1 flex flex-col px-4 py-6">
      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-md flex flex-col gap-4">
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (textContent.trim() && !isSaving) {
                  handleTextSave();
                }
              }
            }}
            placeholder={placeholderText}
            className="w-full h-48 p-4 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 text-lg"
            disabled={isSaving}
            autoFocus
          />
          <button
            onClick={handleTextSave}
            disabled={!textContent.trim() || isSaving}
            className={`w-full py-4 rounded-lg font-medium text-lg transition-colors ${
              saveStatus === "success"
                ? "bg-green-500 text-white"
                : !textContent.trim() || isSaving
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]"
            }`}
          >
            {isSaving ? "Saving..." : saveStatus === "success" ? "Saved!" : "Save Note"}
          </button>
          {saveStatus === "error" && (
            <p className="text-red-600 text-sm text-center">{errorMessage}</p>
          )}
        </div>
      </div>

      {/* Footer with version only */}
      <div className="flex justify-center pt-4">
        <p className="text-xs text-gray-400">v{APP_VERSION}</p>
      </div>
    </div>
  );
}
