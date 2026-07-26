// NDJSON stream reader for the AI generate endpoint.
//
// Extracted out of AiSchedulePanel.tsx (at its size ceiling): the buffer
// splitting is fiddly, has nothing to do with the panel's UI state, and is the
// part that has to be right for a multi-minute stream. A chunk boundary can
// land mid-line, so lines are only parsed once a newline has actually arrived,
// and a trailing partial line is deliberately dropped rather than parsed.

import type { AiStreamEvent } from './streamTypes';

export async function* readNdjsonEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AiStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (line.length === 0) continue;
      yield JSON.parse(line) as AiStreamEvent;
    }
  }
}
