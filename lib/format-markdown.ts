/**
 * Simple markdown formatting for message content
 * Handles links, bold, lists, code blocks, headings
 */
export function formatMarkdown(text: string): string {
  let html = text;

  // Links: [text](url) -> <a href="url">text</a>
  // Process links FIRST before other formatting to avoid conflicts
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">$1</a>');

  // Code blocks: ```code``` -> <pre><code>code</code></pre>
  // Process BEFORE bold to avoid conflicts with asterisks
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 p-3 rounded my-2 overflow-x-auto text-sm"><code>$1</code></pre>');

  // Inline code: `code` -> <code>code</code>
  html = html.replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">$1</code>');

  // Headings: ### text -> <h3>
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-2">$1</h2>');

  // Bold text: **text** -> <strong>text</strong>
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Process bullet lists - group consecutive list items
  // Handle both "- item" and "* item" formats
  const lines = html.split('\n');
  const processedLines: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^[\*\-] (.+)$/);

    if (bulletMatch) {
      if (!inList) {
        processedLines.push('<ul class="list-disc ml-6 my-2 space-y-1">');
        inList = true;
      }
      processedLines.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) {
        processedLines.push('</ul>');
        inList = false;
      }
      processedLines.push(line);
    }
  }

  if (inList) {
    processedLines.push('</ul>');
  }

  html = processedLines.join('\n');

  // Horizontal rules: --- -> <hr>
  html = html.replace(/^---$/gm, '<hr class="my-4 border-gray-200">');

  // Line breaks - double newlines create paragraphs
  html = html.replace(/\n\n/g, '</p><p class="mt-3">');

  // Single newlines within paragraphs
  html = html.replace(/\n/g, '<br>');

  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*<br>\s*<\/p>/g, '');

  return html;
}
