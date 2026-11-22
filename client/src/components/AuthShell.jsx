import { Link } from 'react-router-dom';
import Wordmark from './Wordmark.jsx';

export default function AuthShell({ title, intro, alt, children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Wordmark />
          <p className="text-sm text-ink-soft">
            {alt.text} <Link to={alt.to} className="font-medium text-ink underline underline-offset-4">{alt.label}</Link>
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-20 pt-14 sm:pt-24">
        <div className="max-w-md">
          <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">{title}</h1>
          {intro && <p className="mt-4 text-lg leading-snug text-ink-soft">{intro}</p>}
          <div className="mt-10">{children}</div>
        </div>
      </main>

      <footer className="border-t border-rule">
        <p className="mx-auto max-w-5xl px-6 py-5 text-sm text-ink-faint">Audio and video are encrypted between participants.</p>
      </footer>
    </div>
  );
}