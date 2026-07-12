// Streaming AI schedule generation.
//
// The loop runs for minutes across ~10 sequential model calls, so a single
// return would blank the screen the whole time. This route streams NDJSON
// progress events (see AiStreamEvent) as the loop runs: phase markers, per-day
// starts/repairs, and each day's settled shifts, so the client fills the
// builder grid one day at a time. The terminal event is the full proposal.
// Read-only: drafts are written only by the acceptAiSchedule action.

import { runAiSchedule, type AiProgressEvent } from '@shift/core';

import { createAnthropicScheduleLlm } from '@/lib/ai/anthropic';
import { estimateCostUsd } from '@/lib/ai/pricing';
import { buildProposalDto } from '@/lib/ai/proposal';
import type { AiStreamEvent } from '@/lib/ai/streamTypes';
import { canBuildForHouse, canBuildSchedule, getSessionUser } from '@/lib/auth';
import { getAiScheduleContext } from '@/lib/data/aiSchedule';

// The loop is a multi-minute LLM chain; give deployed runtimes headroom.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const body: unknown = await request.json().catch(() => ({}));
  const houseId =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { houseId?: unknown }).houseId === 'string'
      ? (body as { houseId: string }).houseId
      : '';

  // Cancellation: the client's Stop / Stop and clear buttons abort their own
  // fetch, which the runtime surfaces here via the stream's `cancel()` (the
  // standard Web Streams signal for "the consumer went away"). Threading the
  // resulting AbortSignal into runAiSchedule stops it from issuing any FURTHER
  // (paid) model calls; a call already in flight still finishes normally.
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Both defensive: once the client has disconnected, enqueue/close on the
      // now-cancelled controller throw. Nothing to deliver to at that point,
      // so swallow rather than let it surface as an unhandled rejection.
      const send = (event: AiStreamEvent): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client disconnected */
        }
      };
      const fail = (message: string): void => {
        send({ t: 'error', message });
        try {
          controller.close();
        } catch {
          /* already closed/cancelled */
        }
      };

      try {
        const me = await getSessionUser();
        if (!canBuildSchedule(me) || !canBuildForHouse(me, houseId)) {
          return fail('You are not authorized to build this schedule.');
        }

        const ctx = await getAiScheduleContext(houseId);
        if (!ctx.gate.canGenerate || ctx.input === null) {
          return fail(ctx.gate.reason ?? 'The generator is not available right now.');
        }

        // DEV-ONLY TEST SCAFFOLDING: set AI_SCHEDULE_MOCK=1 to replay the same
        // phase/day-start/day-repair events with dummy delays instead of paying
        // for a real model run, so the progress card can be exercised on a real
        // dev server. Remove this block once the card is signed off; it never
        // activates unless the env var is explicitly set.
        if (process.env.AI_SCHEDULE_MOCK === '1') {
          const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
          const stopped = () => abortController.signal.aborted;
          const weekdays = Array.from(new Set(ctx.input.blocks.map((b) => b.weekday))).sort(
            (a, b) => a - b,
          );

          send({ t: 'phase', phase: 'planning' });
          await wait(1200);
          if (stopped()) return;
          send({ t: 'phase', phase: 'planned' });
          await wait(900);
          for (let i = 0; i < weekdays.length && !stopped(); i++) {
            const weekday = weekdays[i]!;
            send({ t: 'day-start', weekday, dayIndex: i, dayCount: weekdays.length });
            await wait(1000);
            if (stopped()) break;
            if (i === 1) {
              send({ t: 'day-repair', weekday, round: 1 });
              await wait(1200);
              if (stopped()) break;
            }
          }
          if (stopped()) return;
          send({ t: 'phase', phase: 'finalizing' });
          await wait(900 * 5);
          // No 'result' event: the client just returns to idle, since the point
          // is to watch the day stepper, not to exercise the accept-draft flow.
          controller.close();
          return;
        }

        let handle;
        try {
          handle = createAnthropicScheduleLlm();
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'The AI service is not configured.');
        }
        const { llm, usage, model } = handle;
        const startedAt = Date.now();

        const onProgress = (ev: AiProgressEvent): void => {
          switch (ev.type) {
            case 'planning':
            case 'planned':
            case 'finalizing':
              send({ t: 'phase', phase: ev.type });
              break;
            case 'day-start':
              send({
                t: 'day-start',
                weekday: ev.weekday,
                dayIndex: ev.dayIndex,
                dayCount: ev.dayCount,
              });
              break;
            case 'day-repair':
              send({ t: 'day-repair', weekday: ev.weekday, round: ev.round });
              break;
            case 'day-done':
              send({ t: 'day-fill', weekday: ev.weekday, assignments: ev.assignments });
              break;
          }
        };

        const result = await runAiSchedule(ctx.input, llm, {
          candidates: 1,
          planningPass: true,
          finalize: true,
          onProgress,
          signal: abortController.signal,
        });

        // The client severed the connection to trigger the stop (there is no
        // other way to reach it mid-stream), so it is gone regardless of what
        // partial result the loop produced; skip building/sending it.
        if (abortController.signal.aborted) return;

        const dto = buildProposalDto({
          houseId,
          input: ctx.input,
          workerNamesById: ctx.workerNamesById,
          existingDraftCount: ctx.existingDraftCount,
          result,
          run: {
            calls: usage.calls,
            durationMs: Date.now() - startedAt,
            costUsd: estimateCostUsd(model, usage),
            model,
          },
        });
        if (dto === null) {
          return fail('The generator could not produce a schedule. Try again.');
        }

        send({ t: 'result', data: dto });
        controller.close();
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Schedule generation failed. Try again.');
      }
    },
    // Fires when the client disconnects (its fetch was aborted, or the tab
    // closed) — the one reliable, runtime-agnostic signal for "stop now".
    cancel(reason) {
      abortController.abort(reason);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
