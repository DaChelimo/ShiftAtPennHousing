'use client';

import { useRef, useState } from 'react';

import type { Citation, RouteInfo } from '../../../lib/actions/assistant';
import type { AssistantStreamEvent } from '../../../lib/assistant/streamTypes';

import { PageDraftModal } from '@/components/assistant/PageDraftModal';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  deferred?: boolean;
  route?: RouteInfo | null;
  lifeSafety?: string | null;
}

let localId = 0;
const nextId = (): string => `m${(localId += 1)}`;

export function AssistantChat({ surface, desk = false }: { surface: string; desk?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollDown = (): void => {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  };

  async function submit(): Promise<void> {
    const question = input.trim();
    if (question === '' || loading) return;
    setError(null);
    setInput('');

    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: question },
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    scrollDown();
    setLoading(true);

    const patchAssistant = (patch: Partial<ChatMessage>): void => {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
    };

    try {
      const resp = await fetch('/api/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversationId, surface }),
      });
      if (!resp.ok || resp.body === null) {
        throw new Error('Snoopy could not be reached. Try again.');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamError: string | null = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep = buf.indexOf('\n\n');
        while (sep >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          sep = buf.indexOf('\n\n');
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine === undefined) continue;
          const ev = JSON.parse(dataLine.slice(5).trim()) as AssistantStreamEvent;
          switch (ev.t) {
            case 'meta':
              if (ev.conversationId) setConversationId(ev.conversationId);
              patchAssistant({
                citations: ev.citations,
                deferred: ev.deferred,
                route: ev.route,
                lifeSafety: ev.safety?.lifeSafety ?? null,
              });
              break;
            case 'delta':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + ev.text } : m,
                ),
              );
              scrollDown();
              break;
            case 'retract':
              // The leakage guardrail tripped mid-stream: discard the partial text and
              // replace it with the refusal — never a grounded answer.
              patchAssistant({ content: ev.content, citations: [], deferred: false, route: null });
              break;
            case 'done':
              break;
            case 'error':
              streamError = ev.message;
              break;
          }
        }
      }

      if (streamError !== null) {
        setError(streamError);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Snoopy.');
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setLoading(false);
      scrollDown();
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="assistant-chat">
      <div
        ref={listRef}
        className={`flex flex-col gap-3 overflow-y-auto ${desk ? 'max-h-[70dvh]' : 'max-h-[62dvh]'}`}
        data-testid="assistant-messages"
      >
        {messages.length === 0 && (
          <div
            className="rounded-lg border border-border-subtle bg-surface p-4 text-sm text-text-secondary"
            data-testid="assistant-empty"
          >
            Ask a desk question. Answers are grounded in the official documentation and cite their
            source. For fire, medical, or emergency-door situations, call the emergency line first.
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div
              key={m.id}
              className="self-end rounded-2xl bg-brand px-4 py-2 text-text-on-color"
              data-testid="msg-user"
            >
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-2" data-testid="msg-assistant">
              {m.lifeSafety && (
                <div
                  className="rounded-lg border-l-4 border-[color:var(--warn)] bg-[color:var(--warn-bg)] px-3 py-2 text-sm font-medium text-text-primary"
                  data-testid="safety-banner"
                >
                  Life-safety situation. Call the emergency line now, then follow the steps below.
                </div>
              )}
              <div
                className="whitespace-pre-wrap rounded-2xl border border-border-subtle bg-surface px-4 py-3"
                data-testid={m.content === '' ? 'assistant-loading' : undefined}
              >
                {m.content === '' ? 'Thinking...' : m.content}
              </div>
              {m.citations && m.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5" data-testid="citation-chips">
                  {m.citations.map((c) => (
                    <span
                      key={c.documentId}
                      className="rounded-full border border-brand-subtle-border bg-brand-subtle-bg px-2.5 py-0.5 text-xs text-text-primary"
                    >
                      {c.sourceRef}
                    </span>
                  ))}
                </div>
              )}
              {m.deferred && (
                <div
                  className="rounded-lg border border-border-subtle bg-surface p-3"
                  data-testid="routing-card"
                >
                  <div className="text-sm font-medium">No documented source for that.</div>
                  {m.route && (
                    <div className="mt-1 text-sm text-text-secondary">
                      Suggested contact: {m.route.tierLabel ?? m.route.resolvedTier}
                      {m.route.contact?.name ? ` (${m.route.contact.name})` : ''}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setDraftOpen(true)}
                    className="mt-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-text-on-color hover:bg-brand-hover"
                    data-testid="draft-page-button"
                  >
                    Draft a page
                  </button>
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {error && (
        <div
          className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary"
          data-testid="assistant-error"
        >
          {error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={desk ? 2 : 1}
          placeholder="Ask a desk question..."
          className="min-h-11 flex-1 resize-none rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-primary placeholder:text-text-placeholder focus:border-brand focus:outline-none"
          data-testid="assistant-input"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading || input.trim() === ''}
          className="h-11 rounded-lg bg-brand px-4 font-medium text-text-on-color hover:bg-brand-hover disabled:opacity-50"
          data-testid="assistant-send"
        >
          Send
        </button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setDraftOpen(true)}
          className="text-sm text-brand underline-offset-2 hover:underline"
          data-testid="open-draft-page"
        >
          Draft a page to escalate
        </button>
      </div>

      {draftOpen && (
        <PageDraftModal conversationId={conversationId} onClose={() => setDraftOpen(false)} />
      )}
    </div>
  );
}
