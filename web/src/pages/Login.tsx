import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Btn, Field, Input } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="brand-mark">Cold Post</div>
        <div className="brand-sub" style={{ color: '#a49a89' }}>Physical campaigns · gifting · fulfilment</div>
        <div className="tagline">
          Every package leaves the studio <em>exactly</em> as intended.
        </div>
        <div className="meta">Orders · procurement · assembly · QC · dispatch</div>
      </div>
      <div className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <h1>Sign in</h1>
          <p className="muted small" style={{ marginTop: 6, marginBottom: 22 }}>
            Internal operations dashboard. Accounts are managed by an administrator.
          </p>
          <div className="stack">
            <Field label="Email">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@coldpost.in" required />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </Field>
            {error ? <div className="alert alert-bad">{error}</div> : null}
            <Btn variant="primary" type="submit" loading={busy} block>Sign in</Btn>
          </div>
          <div className="login-demo">
            <div className="tag">First run</div>
            <p className="small muted" style={{ marginTop: 6 }}>
              The seeded admin account is <span className="code">admin@coldpost.in</span> with the password from your <span className="code">.env</span> file.
              Change it in Settings → Users after signing in.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
