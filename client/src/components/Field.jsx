import { useId, useState } from 'react';

export default function Field({ label, hint, error, type = 'text', ...inputProps }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [hint && !error && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && shown ? 'text' : type}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          className={`h-11 w-full rounded border bg-surface px-3 text-base hover:border-ink ${isPassword ? 'pr-16' : ''} ${error ? 'border-danger' : 'border-edge'}`}
          {...inputProps}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 rounded px-3 text-sm font-medium text-ink-soft hover:text-ink"
          >
            {shown ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-faint">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}