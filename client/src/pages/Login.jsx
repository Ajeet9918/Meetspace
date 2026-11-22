import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell.jsx';
import Field from '../components/Field.jsx';
import FormError from '../components/FormError.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form);
      const from = typeof location.state?.from === 'string' && location.state.from.startsWith('/') ? location.state.from : '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.status === 401 ? 'The email or password is incorrect.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Log in"
      intro="Host meetings and manage your invite links."
      alt={{ text: 'New here?', to: '/signup', label: 'Create an account' }}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormError>{error}</FormError>
        <Field label="Email" type="email" autoComplete="username" required maxLength={254} value={form.email} onChange={set('email')} />
        <Field label="Password" type="password" autoComplete="current-password" required maxLength={128} value={form.password} onChange={set('password')} />
        <button disabled={busy} className="btn w-full sm:w-auto">{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </AuthShell>
  );
}