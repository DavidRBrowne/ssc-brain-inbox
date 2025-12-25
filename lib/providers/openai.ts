/**
 * OpenAI Provider Implementation
 * Handles streaming API calls to GPT models with function calling support
 */

import type {
  ModelDefinition,
  SendMessageOptions,
  KeyValidationResult,
} from './types';

import { getModelsForProvider, calculateCost, LOAD_FILE_TOOL } from './types';

// ============================================================================
// KEY VALIDATION
// ============================================================================

export async function validateKey(key: string): Promise<KeyValidationResult> {
  try {
    // List models endpoint is lightweight and validates the key
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${key}`,
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    const error = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
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
  return getModelsForProvider('openai');
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
    abortSignal,
    loadFileContents,
  } = options;

  callbacks.onStart?.();

  // Convert messages to OpenAI format
  // Note: OpenAI uses 'developer' role instead of 'system' for newer models
  const openAIMessages: Array<{ role: string; content: string }> = [
    { role: 'developer', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  ];

  // Build tools array for function calling
  const tools: Array<Record<string, unknown>> = [];

  if (loadFileContents) {
    tools.push({
      type: 'function',
      function: {
        name: LOAD_FILE_TOOL.name,
        description: LOAD_FILE_TOOL.description,
        parameters: {
          type: 'object',
          properties: LOAD_FILE_TOOL.parameters.properties,
          required: LOAD_FILE_TOOL.parameters.required,
        },
      },
    });
  }

  // Track pending tool calls
  interface PendingToolCall {
    id: string;
    name: string;
    arguments: string;
  }

  // Inner function to make a streaming request
  async function makeStreamingRequest(
    currentMessages: Array<{ role: string; content: string | Array<{ type: string; tool_call_id?: string; content?: string }> }>,
    totalInputTokens: number,
    totalOutputTokens: number,
    accumulatedResponse: string
  ): Promise<void> {
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: currentMessages,
      max_completion_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
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
    let inputTokens = totalInputTokens;
    let outputTokens = totalOutputTokens;
    const pendingToolCalls: Map<number, PendingToolCall> = new Map();
    let finishReason = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Handle content delta
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              // Text content
              if (delta.content) {
                fullResponse += delta.content;
                callbacks.onToken?.(delta.content);
              }

              // Tool calls
              if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index ?? 0;

                  if (!pendingToolCalls.has(index)) {
                    pendingToolCalls.set(index, {
                      id: toolCall.id || '',
                      name: toolCall.function?.name || '',
                      arguments: '',
                    });
                    // Notify that we're loading a file
                    if (toolCall.function?.name === 'load_file') {
                      callbacks.onFileLoad?.('Loading file...');
                    }
                  }

                  const pending = pendingToolCalls.get(index)!;
                  if (toolCall.id) pending.id = toolCall.id;
                  if (toolCall.function?.name) pending.name = toolCall.function.name;
                  if (toolCall.function?.arguments) {
                    pending.arguments += toolCall.function.arguments;
                    // Try to parse and show progress
                    if (pending.name === 'load_file') {
                      try {
                        const args = JSON.parse(pending.arguments);
                        if (args.path) {
                          callbacks.onFileLoad?.(args.path);
                        }
                      } catch {
                        // Partial JSON
                      }
                    }
                  }
                }
              }
            }

            // Handle finish reason
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }

            // Handle usage data (comes in final chunk with stream_options)
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens || 0;
              outputTokens = parsed.usage.completion_tokens || 0;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    // Check if we need to handle tool calls
    if (finishReason === 'tool_calls' && pendingToolCalls.size > 0 && loadFileContents) {
      // Build assistant message with tool calls
      const toolCallsArray = Array.from(pendingToolCalls.values()).map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }));

      // Execute the load_file tool calls
      const toolResults: Array<{ type: string; tool_call_id: string; content: string }> = [];

      for (const toolCall of Array.from(pendingToolCalls.values())) {
        if (toolCall.name === 'load_file') {
          try {
            const args = JSON.parse(toolCall.arguments);
            const path = args.path as string;
            callbacks.onFileLoad?.(path);

            const files = await loadFileContents([path]);
            const file = files[0];
            if (file && !file.content.startsWith('[Error')) {
              toolResults.push({
                type: 'tool',
                tool_call_id: toolCall.id,
                content: `File: ${file.path}\n\n${file.content}`,
              });
              callbacks.onFileLoaded?.(path, true);
            } else {
              toolResults.push({
                type: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: Could not load file "${path}". Make sure the path is correct.`,
              });
              callbacks.onFileLoaded?.(path, false);
            }
          } catch (err) {
            toolResults.push({
              type: 'tool',
              tool_call_id: toolCall.id,
              content: `Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`,
            });
            callbacks.onFileLoaded?.(toolCall.arguments, false);
          }
        }
      }

      // Continue the conversation with tool results
      const updatedMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: fullResponse || null,
          tool_calls: toolCallsArray,
        },
        ...toolResults.map(tr => ({
          role: 'tool',
          tool_call_id: tr.tool_call_id,
          content: tr.content,
        })),
      ] as Array<{ role: string; content: string | Array<{ type: string; tool_call_id?: string; content?: string }> }>;

      // Recursive call to continue streaming
      await makeStreamingRequest(updatedMessages, inputTokens, outputTokens, fullResponse);
    } else {
      // No more tool calls, report final usage and complete
      if (callbacks.onUsage && (inputTokens > 0 || outputTokens > 0)) {
        const cost = calculateCost(inputTokens, outputTokens, modelId, 0);
        callbacks.onUsage({
          inputTokens,
          outputTokens,
          webSearches: 0,
          cost,
        });
      }
      callbacks.onComplete?.(fullResponse);
    }
  }

  try {
    await makeStreamingRequest(openAIMessages, 0, 0, '');
  } catch (err) {
    // Check if it's an abort error
    if (err instanceof Error && err.name === 'AbortError') {
      return; // Silently handle abort
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
    callbacks.onError?.(errorMessage);
  }
}
