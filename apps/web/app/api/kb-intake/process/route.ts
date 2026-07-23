// Streaming KB intake processing. Mirrors app/api/schedule/ai-generate/route.ts's
// pattern: a single blocking Server Action hides a multi-step, multi-second
// pipeline behind one opaque spinner. This route streams NDJSON progress events
// as runIntakePipeline runs (per-page extraction, token-by-token proposal
// drafting), so the client can show exactly what's happening and why, instead
// of "Uploading..." for a minute and a half with no visibility.

import { getSessionUser } from '@/lib/auth';
import { isKbAdmin, runIntakePipeline, type KbIntakeStreamEvent } from '@/lib/kbIntakePipeline';

// Vision transcription across several pages plus a streamed propose call can
// run well past the platform's default function timeout.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const body: unknown = await request.json().catch(() => ({}));
  const intakeId =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { intakeId?: unknown }).intakeId === 'string'
      ? (body as { intakeId: string }).intakeId
      : '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: KbIntakeStreamEvent): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client disconnected */
        }
      };

      try {
        const me = await getSessionUser();
        if (!isKbAdmin(me)) {
          send({
            t: 'error',
            step: 'lookup',
            message: 'You are not authorized to process this document.',
          });
          return;
        }
        if (intakeId === '') {
          send({ t: 'error', step: 'lookup', message: 'Missing intake id.' });
          return;
        }
        await runIntakePipeline(intakeId, send);
      } catch (err) {
        send({
          t: 'error',
          step: 'lookup',
          message: err instanceof Error ? err.message : 'The pipeline failed unexpectedly.',
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed/cancelled */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
