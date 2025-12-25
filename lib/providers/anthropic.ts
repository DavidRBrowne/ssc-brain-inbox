/**
 * Anthropic Provider Implementation
 * Handles streaming API calls to Claude models with full tool support
 */

import type {
  ModelDefinition,
  SendMessageOptions,
  KeyValidationResult,
  UsageData,
} from './types';

import { getModelsForProvider, calculateCost, LOAD_FILE_TOOL } from './types';

// ============================================================================
// KEY VALIDATION
// ============================================================================

export async function validateKey(key: string): Promise<KeyValidationResult> {
  try {
    // Make a minimal API call to validate the key
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.ok) {
      return { valid: true };
    }

    const error = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (response.status === 403) {
      return { valid: false, error: 'API key lacks required permissions' };
    }

    return { valid: false, error: error.error?.message || `API error: ${response.status}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Failed to validate key' };
  }
}

// ============================================================================
// GET MODELS
// ============================================================================

export function getModels(): ModelDefinition[] {
  return getModelsForProvider('anthropic');
}

// ============================================================================
// SEND MESSAGE WITH STREAMING
// ============================================================================

export async function sendMessage(options: SendMessageOptions): Promise<void> {
  const {
    messages,
    systemPrompt,
    apiKey,
    modelId,
    callbacks,
    enableWebSearch = false,
    enableCodeExecution = false,
    abortSignal,
    loadFileContents,
  } = options;

  callbacks.onStart?.();

  // Build tools array
  const tools: Array<Record<string, unknown>> = [];

  // Always add load_file tool if loadFileContents function is provided
  if (loadFileContents) {
    tools.push({
      name: LOAD_FILE_TOOL.name,
      description: LOAD_FILE_TOOL.description,
      input_schema: {
        type: 'object',
        properties: LOAD_FILE_TOOL.parameters.properties,
        required: LOAD_FILE_TOOL.parameters.required,
      },
    });
  }

  if (enableWebSearch) {
    tools.push({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3, // Limit searches per request to control costs
    });
  }

  if (enableCodeExecution) {
    tools.push({
      type: 'code_execution_20250522',
      name: 'code_execution',
    });
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  if (enableCodeExecution) {
    headers['anthropic-beta'] = 'code-execution-2025-05-22';
  }

  // Track pending tool calls
  interface PendingToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
  }

  // Inner function to make a streaming request
  async function makeStreamingRequest(
    currentMessages: Array<{ role: string; content: unknown }>,
    totalInputTokens: number,
    totalOutputTokens: number,
    totalWebSearches: number,
    accumulatedResponse: string
  ): Promise<void> {
    const requestBody: Record<string, unknown> = {
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: currentMessages,
      stream: true,
    };

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullResponse = accumulatedResponse;
    let buffer = '';
    let currentToolId = '';
    let currentToolName = '';
    let currentToolInput = '';
    let webSearchCount = totalWebSearches;
    let inputTokens = totalInputTokens;
    let outputTokens = totalOutputTokens;
    let stopReason = '';
    const pendingToolCalls: PendingToolCall[] = [];
    const contentBlocks: Array<{ type: string; [key: string]: unknown }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Handle content block start
            if (parsed.type === 'content_block_start') {
              const block = parsed.content_block;
              if (block?.type === 'tool_use') {
                // Custom tool call (like load_file)
                currentToolId = block.id || '';
                currentToolName = block.name || '';
                currentToolInput = '';
                if (currentToolName === 'load_file') {
                  callbacks.onFileLoad?.('Loading file...');
                }
              } else if (block?.type === 'server_tool_use') {
                currentToolName = block.name || '';
                if (currentToolName === 'web_search') {
                  callbacks.onWebSearch?.('Searching the web...');
                } else if (currentToolName === 'code_execution') {
                  callbacks.onCodeExecution?.('Running code...');
                }
              } else if (block?.type === 'code_execution_tool_result') {
                callbacks.onCodeExecutionComplete?.();
              } else if (block?.type === 'code_execution_tool_result_error') {
                callbacks.onToolError?.('code_execution', block.error_message || 'Code execution failed');
              } else if (block?.type === 'web_search_tool_result_error') {
                callbacks.onToolError?.('web_search', block.error_message || 'Web search failed');
              } else if (block?.type === 'web_search_tool_result') {
                if (block.search_results && Array.isArray(block.search_results)) {
                  webSearchCount++;
                  callbacks.onWebSearchResults?.(block.search_results.length);
                }
              }
            }

            // Handle content block delta
            if (parsed.type === 'content_block_delta') {
              const delta = parsed.delta;
              if (delta?.type === 'text_delta' && delta?.text) {
                fullResponse += delta.text;
                callbacks.onToken?.(delta.text);
              }
              if (delta?.type === 'input_json_delta' && delta?.partial_json) {
                currentToolInput += delta.partial_json;
                // Show progress for tools
                if (currentToolName === 'load_file') {
                  try {
                    const partialInput = JSON.parse(currentToolInput);
                    if (partialInput.path) {
                      callbacks.onFileLoad?.(partialInput.path);
                    }
                  } catch {
                    // Partial JSON
                  }
                } else if (currentToolName === 'web_search') {
                  try {
                    const partialInput = JSON.parse(currentToolInput);
                    if (partialInput.query) {
                      callbacks.onWebSearch?.(partialInput.query);
                    }
                  } catch {
                    // Partial JSON
                  }
                }
              }
            }

            // Handle content block stop
            if (parsed.type === 'content_block_stop') {
              if (currentToolName === 'load_file' && currentToolId && currentToolInput) {
                try {
                  const input = JSON.parse(currentToolInput);
                  pendingToolCalls.push({
                    id: currentToolId,
                    name: currentToolName,
                    input: input as Record<string, unknown>,
                  });
                  // Track the tool_use block for the assistant message
                  contentBlocks.push({
                    type: 'tool_use',
                    id: currentToolId,
                    name: currentToolName,
                    input,
                  });
                } catch {
                  // Ignore parse errors
                }
              }
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
            }

            // Track usage
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              inputTokens += parsed.message.usage.input_tokens || 0;
            }
            if (parsed.type === 'message_delta') {
              if (parsed.usage) {
                outputTokens += parsed.usage.output_tokens || 0;
              }
              if (parsed.delta?.stop_reason) {
                stopReason = parsed.delta.stop_reason;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    // Check if we need to handle tool calls
    if (stopReason === 'tool_use' && pendingToolCalls.length > 0 && loadFileContents) {
      // Execute the load_file tool calls
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

      for (const toolCall of pendingToolCalls) {
        if (toolCall.name === 'load_file') {
          const path = toolCall.input.path as string;
          callbacks.onFileLoad?.(path);

          try {
            // Load the file content
            const files = await loadFileContents([path]);
            const file = files[0];
            if (file && !file.content.startsWith('[Error')) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: `File: ${file.path}\n\n${file.content}`,
              });
              callbacks.onFileLoaded?.(path, true);
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: `Error: Could not load file "${path}". Make sure the path is correct.`,
              });
              callbacks.onFileLoaded?.(path, false);
            }
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`,
            });
            callbacks.onFileLoaded?.(path, false);
          }
        }
      }

      // Build assistant message with tool use blocks
      const assistantContent: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];
      if (fullResponse) {
        assistantContent.push({ type: 'text', text: fullResponse });
      }
      for (const block of contentBlocks) {
        if (block.type === 'tool_use') {
          assistantContent.push({
            type: 'tool_use',
            id: block.id as string,
            name: block.name as string,
            input: block.input,
          });
        }
      }

      // Continue the conversation with tool results
      const updatedMessages = [
        ...currentMessages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      ];

      // Recursive call to continue streaming
      await makeStreamingRequest(updatedMessages, inputTokens, outputTokens, webSearchCount, fullResponse);
    } else {
      // No more tool calls, report final usage and complete
      if (callbacks.onUsage && (inputTokens > 0 || outputTokens > 0)) {
        const cost = calculateCost(inputTokens, outputTokens, modelId, webSearchCount);
        callbacks.onUsage({
          inputTokens,
          outputTokens,
          webSearches: webSearchCount,
          cost,
        });
      }
      callbacks.onComplete?.(fullResponse);
    }
  }

  try {
    await makeStreamingRequest(messages as Array<{ role: string; content: unknown }>, 0, 0, 0, '');
  } catch (err) {
    // Check if it's an abort error
    if (err instanceof Error && err.name === 'AbortError') {
      return; // Silently handle abort
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
    callbacks.onError?.(errorMessage);
  }
}
