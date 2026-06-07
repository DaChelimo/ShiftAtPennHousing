'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { createClient } from '../../lib/supabase/client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError !== null) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    const redirectTo = searchParams.get('redirectTo') ?? '/';
    router.replace(redirectTo);
    // Refresh so server components re-read the freshly-set session cookie.
    router.refresh();
  }

  return (
    <main
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'linear-gradient(135deg, var(--brand), var(--brand-active))',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="card col gap-6"
        style={{ width: '100%', maxWidth: 400, padding: 40, boxShadow: 'var(--shadow-2)' }}
      >
        <div className="col gap-4">
          <span
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--brand)',
              color: '#fff',
            }}
          >
            <Icon name="calendar" size={24} />
          </span>
          <div className="col gap-1">
            <h1 className="t-h1">
              Shift<span style={{ color: 'var(--brand)', fontWeight: 700 }}>@</span>PennHousing
            </h1>
            <p className="t-helper">Sign in to the admin console.</p>
          </div>
        </div>

        <Field label="Email">
          <TextInput
            data-testid="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password">
          <TextInput
            data-testid="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error !== null && (
          <p
            data-testid="login-error"
            role="alert"
            className="t-helper"
            style={{ color: 'var(--st-danger)' }}
          >
            {error}
          </p>
        )}

        <Button data-testid="login-submit" type="submit" disabled={submitting} full>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams must be wrapped in Suspense for static rendering (Next App Router).
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
