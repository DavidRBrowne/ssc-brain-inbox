"use client";

import { useEffect, useRef } from "react";

interface MarkdownContentProps {
  html: string;
  className?: string;
}

/**
 * Copy text to clipboard with fallback
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      return true;
    }
  } catch (err) {
    console.error("Failed to copy:", err);
    return false;
  }
}

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * Extract code text preserving line breaks
 * Uses innerText which respects visual formatting better than textContent
 */
function extractCodeText(pre: HTMLPreElement): string {
  const code = pre.querySelector("code");
  const element = code || pre;

  // innerText preserves line breaks from <br> and block elements
  // but we also need to handle the case where newlines are in the text
  let text = element.innerText || element.textContent || "";

  // Trim leading/trailing whitespace but preserve internal line breaks
  return text.trim();
}

/**
 * Create a vanilla JS copy button (avoids React rendering issues)
 */
function createCopyButton(pre: HTMLPreElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "copy-btn absolute top-2 right-2 p-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500";
  button.setAttribute("aria-label", "Copy code");
  button.setAttribute("title", "Copy code");
  button.innerHTML = COPY_ICON;

  button.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Extract text at click time to get current content
    const text = extractCodeText(pre);
    const success = await copyToClipboard(text);

    if (success) {
      // Show checkmark
      button.innerHTML = CHECK_ICON;
      button.setAttribute("title", "Copied!");

      // Revert after 2 seconds
      setTimeout(() => {
        button.innerHTML = COPY_ICON;
        button.setAttribute("title", "Copy code");
      }, 2000);
    }
  });

  return button;
}

/**
 * Renders markdown HTML with interactive copy buttons on code blocks
 */
export function MarkdownContent({ html, className = "" }: MarkdownContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Find all pre elements
    const preElements = containerRef.current.querySelectorAll("pre");

    preElements.forEach((pre) => {
      // Remove any existing copy buttons first (handles re-renders)
      const existingBtn = pre.querySelector(".copy-btn");
      if (existingBtn) {
        existingBtn.remove();
      }

      // Make pre relative for absolute positioning of button
      pre.style.position = "relative";

      // Create and append copy button
      const button = createCopyButton(pre as HTMLPreElement);
      pre.appendChild(button);
    });
  }, [html]);

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
