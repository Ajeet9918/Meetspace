import Wordmark from './Wordmark.jsx';

export default function Shell({ children, right }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Wordmark />
          <div className="-mr-3 flex items-center gap-1">{right}</div>
        </div>
      </header>
      {children}
    </div>
  );
}