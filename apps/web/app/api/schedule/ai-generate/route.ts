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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AiStreamEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const fail = (message: string): void => {
        send({ t: 'error', message });
        controller.close();
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
        });

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
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
