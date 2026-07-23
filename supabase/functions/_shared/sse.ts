import { corsHeaders } from './swap-http.ts';

/**
 * A Server-Sent-Events response the caller drives by calling [send] as many times as it
 * likes, then [close] once. Mirrors the SSE framing + headers already used by the web
 * app's `/api/assistant/ask` proxy (`event: <t>\ndata: <json>\n\n`), so `da-ask` and the
 * web/mobile clients share one wire contract.
 */
export function createSseStream(): {
  response: Response;
  send: (event: { t: string; [key: string]: unknown }) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const send = (event: { t: string; [key: string]: unknown }): void => {
    controller.enqueue(encoder.encode(`event: ${event.t}\ndata: ${JSON.stringify(event)}\n\n`));
  };
  const close = (): void => {
    controller.close();
  };

  const response = new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });

  return { response, send, close };
}
