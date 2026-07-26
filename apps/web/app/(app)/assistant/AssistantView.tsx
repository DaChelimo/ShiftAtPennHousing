'use client';

import { useRef, useState } from 'react';

import { PageDraftModal } from '@/components/assistant/PageDraftModal';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { Citation, RouteInfo } from '@/lib/actions/assistant';
import type { AssistantStreamEvent } from '@/lib/assistant/streamTypes';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  citations?: Citation[];
  deferred?: boolean;
  route?: RouteInfo | null;
  lifeSafety?: string | null;
  messageId?: string | null;
}

// Starter prompts grouped by the moment-to-moment questions a desk worker
// actually needs mid-shift, not just policy lookups. Clicking one submits it
// immediately, matching the Ask Linear / AskFred example-card pattern. Grouped
// + scrollable so the set can stay broad without crowding the welcome screen.
const EXAMPLE_GROUPS: Array<{ icon: IconName; heading: string; prompts: string[] }> = [
  {
    icon: 'shield',
    heading: 'Access & keys',
    prompts: [
      'How do I check if a resident has access to a specific room?',
      'Is this contractor or vendor authorized to be in the building today?',
      "How do I check who's on the access list for a common space?",
    ],
  },
  {
    icon: 'warn',
    heading: 'Card & ID issues',
    prompts: [
      "A resident's OneCard isn't swiping. What do I do?",
      'A resident forgot their room number. How do I look it up?',
      "A resident lost their key or key fob. What's the replacement process?",
    ],
  },
  {
    icon: 'people',
    heading: 'Guests & visitors',
    prompts: [
      'What is the guest sign-in policy after midnight?',
      'Can a non-resident guest stay overnight?',
      "How do I sign in a Penn affiliate who isn't a resident?",
    ],
  },
  {
    icon: 'doc',
    heading: 'Lockouts',
    prompts: [
      'A resident is locked out of their room. What are the steps?',
      'A resident is locked out and has no ID. What do I do?',
      'How many lockouts is a resident allowed before a fee applies?',
    ],
  },
  {
    icon: 'layers',
    heading: 'Facilities & maintenance',
    prompts: [
      'Where do I report a facilities issue like a leak or a broken door?',
      'Who do I call for an elevator outage?',
      "How do I report a pest issue in a resident's room?",
    ],
  },
  {
    icon: 'phone',
    heading: 'Duty & emergency contacts',
    prompts: [
      'Who is the HMOD on duty right now?',
      'Who do I contact for an emergency after hours?',
      "What's the escalation path if I can't reach the HMOD?",
    ],
  },
];

let localId = 0;
const nextId = (): string => `m${(localId += 1)}`;

export function AssistantView({
  firstName,
  houseName,
  canDraftPages = true,
}: {
  firstName: string;
  houseName: string;
  // "Draft a page" proposes new KB content — a content-authoring capability,
  // not part of read-only Q&A. Defaults on (unchanged admin behavior); the
  // worker-facing route passes false.
  canDraftPages?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const started = messages.length > 0;

  const scrollDown = (): void => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }),
    );
  };

  function patchAssistant(id: string, patch: Partial<ChatMessage>): void {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function submit(raw?: string): Promise<void> {
    const question = (raw ?? input).trim();
    if (question === '' || streaming) return;
    setError(null);
    setInput('');

    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: question },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    scrollDown();
    setStreaming(true);

    try {
      const resp = await fetch('/api/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversationId, surface: 'web' }),
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
              patchAssistant(assistantId, {
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
              // The leakage guardrail tripped mid-stream: discard whatever partial text
              // was showing and replace it with the refusal — never a grounded answer.
              patchAssistant(assistantId, {
                content: ev.content,
                citations: [],
                deferred: false,
                route: null,
              });
              scrollDown();
              break;
            case 'done':
              patchAssistant(assistantId, { streaming: false, messageId: ev.messageId });
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
      } else {
        patchAssistant(assistantId, { streaming: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Snoopy.');
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
      scrollDown();
    }
  }

  function reset(): void {
    if (streaming) return;
    setMessages([]);
    setConversationId(null);
    setError(null);
    setInput('');
  }

  const composer = (
    <div className="da-composer" data-testid="assistant-composer">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={started ? 1 : 2}
        placeholder="Ask a desk question..."
        className="da-composer-input"
        data-testid="assistant-input"
      />
      <div className="da-composer-foot">
        <span className="da-context-chip" title="Answers are scoped to your house">
          <Icon name="grid" size={13} />
          {houseName}
        </span>
        <div className="da-composer-actions">
          {canDraftPages && (
            <button
              type="button"
              onClick={() => setDraftOpen(true)}
              className="da-ghost-btn"
              data-testid="open-draft-page"
            >
              <Icon name="send" size={14} />
              Draft a page
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={streaming || input.trim() === ''}
            className="da-send-btn"
            aria-label="Send"
            data-testid="assistant-send"
          >
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="da-root" data-testid="assistant-view">
      {!started ? (
        // Welcome hero (Ask Linear / AskFred inspired): greeting, prominent
        // composer, then example prompt cards.
        <div className="da-welcome">
          <div className="da-hero">
            <span className="da-hero-glyph" aria-hidden>
              <Icon name="chat" size={22} />
            </span>
            <h1 className="da-hero-title" data-testid="assistant-greeting">
              Hi {firstName}.
            </h1>
            <p className="da-hero-sub">
              Ask about desk procedures, policies, or who is on duty. Answers are grounded in the
              official documentation and cite their source.
            </p>
          </div>

          {composer}

          {error && (
            <div className="da-error" data-testid="assistant-error">
              {error}
            </div>
          )}

          <div className="da-examples" data-testid="assistant-examples">
            {EXAMPLE_GROUPS.map((group) => (
              <div key={group.heading} className="da-example-group">
                <div className="da-example-group-heading">
                  <Icon name={group.icon} size={14} />
                  {group.heading}
                </div>
                {group.prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="da-example"
                    onClick={() => void submit(prompt)}
                    data-testid="assistant-example"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <p className="da-safety-note">
            For fire, medical, or emergency-door situations, call the emergency line first.
          </p>
        </div>
      ) : (
        // Conversation view: header, scrolling thread, pinned composer.
        <div className="da-thread-wrap">
          <div className="da-thread-head">
            <div className="da-thread-title">
              <span className="da-hero-glyph da-hero-glyph-sm" aria-hidden>
                <Icon name="chat" size={16} />
              </span>
              Ask Snoopy
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={streaming}
              className="da-ghost-btn"
              data-testid="assistant-new-chat"
            >
              <Icon name="add" size={14} />
              New chat
            </button>
          </div>

          <div className="da-thread" ref={listRef} data-testid="assistant-messages">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="da-msg-user" data-testid="msg-user">
                  {m.content}
                </div>
              ) : (
                <div key={m.id} className="da-msg-assistant" data-testid="msg-assistant">
                  <span className="da-msg-avatar" aria-hidden>
                    <Icon name="chat" size={14} />
                  </span>
                  <div className="da-msg-assistant-col">
                    {m.lifeSafety && (
                      <div className="da-safety-banner" data-testid="safety-banner">
                        Life-safety situation. Call the emergency line now, then follow the steps
                        below.
                      </div>
                    )}
                    <div className="da-bubble">
                      {m.content === '' && m.streaming ? (
                        <span className="da-typing" aria-label="Snoopy is typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        <span className="da-bubble-text">
                          {m.content}
                          {m.streaming && <span className="da-caret" aria-hidden />}
                        </span>
                      )}
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <div className="da-citations" data-testid="citation-chips">
                        {m.citations.map((c) => (
                          <span key={c.documentId} className="da-citation">
                            <Icon name="doc" size={12} />
                            {c.sourceRef}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.deferred && (
                      <div className="da-route-card" data-testid="routing-card">
                        <div className="da-route-title">No documented source for that.</div>
                        {m.route && (
                          <div className="da-route-sub">
                            Suggested contact: {m.route.tierLabel ?? m.route.resolvedTier}
                            {m.route.contact?.name ? ` (${m.route.contact.name})` : ''}
                          </div>
                        )}
                        {canDraftPages && (
                          <button
                            type="button"
                            onClick={() => setDraftOpen(true)}
                            className="da-send-inline"
                            data-testid="draft-page-button"
                          >
                            Draft a page
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>

          {error && (
            <div className="da-error da-error-thread" data-testid="assistant-error">
              {error}
            </div>
          )}

          <div className="da-composer-dock">{composer}</div>
        </div>
      )}

      {draftOpen && (
        <PageDraftModal conversationId={conversationId} onClose={() => setDraftOpen(false)} />
      )}
    </div>
  );
}
