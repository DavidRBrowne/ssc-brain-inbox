"use client";

import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Check, Loader2, X } from "lucide-react";
import { FileNode, LoadedFile, formatTokenCount, getContextStatus } from "@/lib/brain-chat";

interface FileBrowserProps {
  tree: FileNode[];
  loadedFiles: LoadedFile[];
  onLoadFiles: (paths: string[]) => Promise<void>;
  onUnloadFile: (path: string) => void;
  isLoading: boolean;
}

export function FileBrowser({
  tree,
  loadedFiles,
  onLoadFiles,
  onUnloadFile,
  isLoading,
}: FileBrowserProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  const loadedPaths = new Set(loadedFiles.map(f => f.path));
  const contextStatus = getContextStatus(loadedFiles);

  // Count loaded files per folder (for showing badges on folders)
  const loadedCountByFolder = new Map<string, number>();
  for (const file of loadedFiles) {
    const parts = file.path.split('/');
    // Build all parent paths
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      loadedCountByFolder.set(folderPath, (loadedCountByFolder.get(folderPath) || 0) + 1);
    }
  }

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Click on a file: if loaded, unload it; if not loaded, load it immediately
  const handleFileClick = useCallback(async (path: string) => {
    if (loadedPaths.has(path)) {
      onUnloadFile(path);
      return;
    }

    // Load immediately
    setLoadingPath(path);
    try {
      await onLoadFiles([path]);
    } finally {
      setLoadingPath(null);
    }
  }, [loadedPaths, onUnloadFile, onLoadFiles]);

  const renderNode = (node: FileNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedDirs.has(node.path);
    const isLoaded = loadedPaths.has(node.path);
    const isCurrentlyLoading = loadingPath === node.path;
    const isDir = node.type === 'dir';
    const loadedInFolder = isDir ? loadedCountByFolder.get(node.path) || 0 : 0;
    const hasLoadedFiles = loadedInFolder > 0;

    // Only show markdown files and directories
    if (!isDir && !node.name.endsWith('.md')) {
      return null;
    }

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-sm transition-colors ${
            isLoaded
              ? 'bg-green-50 text-green-800'
              : hasLoadedFiles
              ? 'bg-green-50 text-green-800'
              : isCurrentlyLoading
              ? 'bg-blue-50 text-blue-800'
              : 'hover:bg-gray-100 text-gray-700'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => isDir ? toggleDir(node.path) : handleFileClick(node.path)}
        >
          {isDir ? (
            <>
              {isExpanded ? (
                <ChevronDown className={`w-4 h-4 flex-shrink-0 ${hasLoadedFiles ? 'text-green-500' : 'text-gray-400'}`} />
              ) : (
                <ChevronRight className={`w-4 h-4 flex-shrink-0 ${hasLoadedFiles ? 'text-green-500' : 'text-gray-400'}`} />
              )}
              {isExpanded ? (
                <FolderOpen className={`w-4 h-4 flex-shrink-0 ${hasLoadedFiles ? 'text-green-500' : 'text-amber-500'}`} />
              ) : (
                <Folder className={`w-4 h-4 flex-shrink-0 ${hasLoadedFiles ? 'text-green-500' : 'text-amber-500'}`} />
              )}
            </>
          ) : (
            <>
              <span className="w-4" />
              {isCurrentlyLoading ? (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
              ) : isLoaded ? (
                <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
              ) : (
                <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
              )}
            </>
          )}
          <span className="truncate flex-1">{node.name}</span>
          {isDir && hasLoadedFiles && (
            <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
              {loadedInFolder}
            </span>
          )}
        </div>

        {isDir && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header with files count and tokens together */}
      <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-900 text-sm">Files</h3>
          <span className={`text-xs ${
            contextStatus.isOverLimit
              ? 'text-red-600'
              : contextStatus.isWarning
              ? 'text-amber-600'
              : 'text-gray-500'
          }`}>
            {loadedFiles.length} loaded · {contextStatus.message}
          </span>
        </div>
      </div>

      {/* Loaded files section - scrollable, max ~150px */}
      {loadedFiles.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-100 bg-green-50 flex-shrink-0 max-h-40 overflow-y-auto">
          <div className="space-y-1">
            {loadedFiles.map(file => (
              <div
                key={file.path}
                className="flex items-center justify-between text-xs text-green-700 bg-white rounded px-2 py-1"
              >
                <span className="truncate flex-1">{file.path}</span>
                <span className="text-green-500 mx-2 flex-shrink-0">
                  {formatTokenCount(file.tokenEstimate)}
                </span>
                <button
                  onClick={() => onUnloadFile(file.path)}
                  className="text-green-400 hover:text-red-500 flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File tree with min-height */}
      <div className="flex-1 overflow-y-auto p-2" style={{ minHeight: '600px' }}>
        {tree.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-4">
            No files found
          </div>
        ) : (
          <div>
            {tree.map(node => renderNode(node))}
          </div>
        )}
      </div>
    </div>
  );
}
