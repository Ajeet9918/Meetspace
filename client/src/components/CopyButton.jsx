import { useState } from 'react';

export default function CopyButton({ text, children = 'Copy invite link', className = 'btn-outline btn-sm' }) {
  const [state, setState] = useState('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  }
  return (
    <button type="button" onClick={copy} className={className}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : children}
    </button>
  );
}