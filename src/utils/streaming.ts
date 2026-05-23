import type { StreamChunk } from '~types';

export async function* streamChatCompletion(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal
): AsyncGenerator<StreamChunk> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error?.message || JSON.stringify(errorBody);
    } catch {
      // use statusText as fallback
    }
    throw new Error(`API error ${response.status}: ${errorMessage}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is empty');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'data: [DONE]') return;

      if (trimmed.startsWith('data: ')) {
        try {
          const data = JSON.parse(trimmed.slice(6)) as StreamChunk;
          yield data;
        } catch {
          // skip malformed SSE line
        }
      }
    }
  }
}
