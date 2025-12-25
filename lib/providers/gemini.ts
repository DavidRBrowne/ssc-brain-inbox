/**
 * Gemini Provider Implementation
 * Handles streaming API calls to Google's Gemini models with function calling support
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
    // List models endpoint validates the key
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    );

    if (response.ok) {
      return { valid: true };
    }

    const error = await response.json().catch(() => ({}));

    if (response.status === 400 || response.status === 403) {
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
  return getModelsForProvider('gemini');
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

  // Convert messages to Gemini format
  // Gemini uses 'user' and 'model' roles, and 'parts' array
  const geminiContents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }> = [];

  for (const msg of messages) {
    geminiContents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  // Build tools array for function calling
  const tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }> = [];

  if (loadFileContents) {
    tools.push({
      functionDeclarations: [{
        name: LOAD_FILE_TOOL.name,
        description: LOAD_FILE_TOOL.description,
        parameters: {
          type: 'object',
          properties: LOAD_FILE_TOOL.parameters.properties,
          required: LOAD_FILE_TOOL.parameters.required,
        },
      }],
    });
  }

  // Track pending function calls
  interface PendingFunctionCall {
    name: string;
    args: Record<string, unknown>;
  }

  // Inner function to make a streaming request
  async function makeStreamingRequest(
    currentContents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }>,
    totalInputTokens: number,
    totalOutputTokens: number,
    accumulatedResponse: string
  ): Promise<void> {
    const requestBody: Record<string, unknown> = {
      contents: currentContents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
      },
    };

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    // Use streaming endpoint with alt=sse
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    const pendingFunctionCalls: PendingFunctionCall[] = [];
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
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            // Handle candidates
            const candidate = parsed.candidates?.[0];
            if (candidate) {
              // Handle content parts
              const parts = candidate.content?.parts;
              if (parts) {
                for (const part of parts) {
                  // Text content
                  if (part.text) {
                    fullResponse += part.text;
                    callbacks.onToken?.(part.text);
                  }

                  // Function call
                  if (part.functionCall) {
                    const funcCall = part.functionCall;
                    pendingFunctionCalls.push({
                      name: funcCall.name,
                      args: funcCall.args || {},
                    });
                    if (funcCall.name === 'load_file') {
                      const path = funcCall.args?.path;
                      callbacks.onFileLoad?.(path || 'Loading file...');
                    }
                  }
                }
              }

              // Handle finish reason
              if (candidate.finishReason) {
                finishReason = candidate.finishReason;
              }
            }

            // Handle usage metadata
            if (parsed.usageMetadata) {
              inputTokens = parsed.usageMetadata.promptTokenCount || inputTokens;
              outputTokens = parsed.usageMetadata.candidatesTokenCount || outputTokens;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    // Check if we need to handle function calls
    // Gemini uses 'STOP' for normal completion, function calls have finishReason 'FUNCTION_CALL' or come without STOP
    const hasFunctionCalls = pendingFunctionCalls.length > 0;

    if (hasFunctionCalls && loadFileContents) {
      // Execute the load_file function calls
      const functionResponses: Array<{ functionResponse: { name: string; response: { content: string } } }> = [];

      for (const funcCall of pendingFunctionCalls) {
        if (funcCall.name === 'load_file') {
          const path = funcCall.args.path as string;
          callbacks.onFileLoad?.(path);

          try {
            const files = await loadFileContents([path]);
            const file = files[0];
            if (file && !file.content.startsWith('[Error')) {
              functionResponses.push({
                functionResponse: {
                  name: funcCall.name,
                  response: {
                    content: `File: ${file.path}\n\n${file.content}`,
                  },
                },
              });
              callbacks.onFileLoaded?.(path, true);
            } else {
              functionResponses.push({
                functionResponse: {
                  name: funcCall.name,
                  response: {
                    content: `Error: Could not load file "${path}". Make sure the path is correct.`,
                  },
                },
              });
              callbacks.onFileLoaded?.(path, false);
            }
          } catch (err) {
            functionResponses.push({
              functionResponse: {
                name: funcCall.name,
                response: {
                  content: `Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`,
                },
              },
            });
            callbacks.onFileLoaded?.(path, false);
          }
        }
      }

      // Build model response with function calls
      const modelParts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> = [];
      if (fullResponse) {
        modelParts.push({ text: fullResponse });
      }
      for (const funcCall of pendingFunctionCalls) {
        modelParts.push({
          functionCall: {
            name: funcCall.name,
            args: funcCall.args,
          },
        });
      }

      // Continue the conversation with function responses
      const updatedContents = [
        ...currentContents,
        { role: 'model', parts: modelParts },
        { role: 'user', parts: functionResponses },
      ];

      // Recursive call to continue streaming
      await makeStreamingRequest(updatedContents, inputTokens, outputTokens, fullResponse);
    } else {
      // No more function calls, report final usage and complete
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
    await makeStreamingRequest(geminiContents, 0, 0, '');
  } catch (err) {
    // Check if it's an abort error
    if (err instanceof Error && err.name === 'AbortError') {
      return; // Silently handle abort
    }

    // Check for blocked response
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
    if (errorMessage.includes('blocked') || errorMessage.includes('safety')) {
      callbacks.onError?.('Response was blocked by safety filters. Try rephrasing your question.');
      return;
    }

    callbacks.onError?.(errorMessage);
  }
}
