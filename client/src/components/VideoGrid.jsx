import { useEffect, useRef, useState } from 'react';

const PAGE = 11; // other people shown at once (plus you). Hidden tiles stop receiving video, which keeps 50-person rooms light.

function Tile({ name, main, audio, self, mirror, muted }) {
  const box = useRef(null);
  const ref = useRef(null);
  const [full, setFull] = useState(false);
  const live = Boolean(main && !main.isMuted);

  // track.attach() lets the media server pick the video quality that fits the tile (and full screen asks for more).
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    main?.attach(el);
    if (!self) audio?.attach(el); // never play your own microphone back at yourself
    return () => { main?.detach(el); if (!self) audio?.detach(el); };
  }, [main, audio, self]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFull() {
    if (document.fullscreenElement) return document.exitFullscreen();
    if (box.current?.requestFullscreen) return box.current.requestFullscreen().catch(() => {});
    return ref.current?.webkitEnterFullscreen?.(); // iPhone Safari only allows fullscreen on the video element itself
  }

  return (
    <div ref={box} onDoubleClick={toggleFull} className="relative aspect-video overflow-hidden rounded bg-ink">
      {/* Names are untrusted; React renders them as text. */}
      <span className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-paper/70" aria-hidden="true">
        {[...name.trim()][0]?.toUpperCase()}
      </span>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={self}
        className={`absolute inset-0 h-full w-full object-contain ${live ? 'opacity-100' : 'opacity-0'}`}
        style={mirror ? { transform: 'scaleX(-1)' } : undefined}
      />
      <span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded bg-ink/75 px-2 py-1 text-sm text-paper">{name}</span>
      {live && (
        <button
          type="button"
          onClick={toggleFull}
          aria-label={full ? `Exit full screen for ${name}` : `View ${name} full screen`}
          className="absolute bottom-2 right-2 rounded bg-ink/75 px-2 py-1 text-xs text-paper hover:bg-ink"
        >
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      )}
      {muted && <span className="absolute right-2 top-2 rounded bg-ink/75 px-2 py-1 text-xs text-paper">Muted</span>}
    </div>
  );
}

export default function VideoGrid({ room, media }) {
  const [page, setPage] = useState(0);
  const { local } = media;
  const canShare = Boolean(navigator.mediaDevices?.getDisplayMedia);

  // People sharing their screen come first so they are never hidden on a later page.
  const others = room.participants
    .filter((p) => p.id !== room.you.id)
    .map((p, i) => ({ p, i, sharing: Boolean(media.remote[p.id]?.sharing) }))
    .sort((a, b) => Number(b.sharing) - Number(a.sharing) || a.i - b.i)
    .map((x) => x.p);
  const pages = Math.max(1, Math.ceil(others.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = others.slice(current * PAGE, current * PAGE + PAGE);

  return (
    <section aria-label="Video" className="mt-10">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile name={`${room.you.name} (you)`} main={local.main} self mirror={!local.sharing} muted={media.started && !local.mic} />
        {visible.map((p) => (
          <Tile key={p.id} name={p.name} main={media.remote[p.id]?.main} audio={media.remote[p.id]?.audio} muted={p.mic === false} />
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm text-ink-soft">
          <button onClick={() => setPage(current - 1)} disabled={current === 0} className="btn-outline btn-sm">Previous</button>
          <span>People {current * PAGE + 1}–{Math.min(others.length, current * PAGE + PAGE)} of {others.length}</span>
          <button onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="btn-outline btn-sm">Next</button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!media.started ? (
          <button onClick={media.start} className="btn btn-sm">Turn on camera and microphone</button>
        ) : (
          <>
            <button onClick={media.toggleMic} className="btn-outline btn-sm">{local.mic ? 'Mute' : 'Unmute'}</button>
            <button onClick={media.toggleCam} className="btn-outline btn-sm">{local.cam ? 'Turn camera off' : 'Turn camera on'}</button>
          </>
        )}
        {canShare && <button onClick={media.toggleShare} className="btn-outline btn-sm">{local.sharing ? 'Stop sharing' : 'Share screen'}</button>}
        {media.audioBlocked && <button onClick={media.enableAudio} className="btn btn-sm">Enable sound</button>}
        <span className="text-sm text-ink-faint">
          {media.status === 'connecting' ? 'Connecting to the media server…' : 'Your browser asks for permission only when you click.'}
        </span>
      </div>
      {media.notice && <p role="status" className="mt-3 text-sm text-ink-soft">{media.notice}</p>}
      {media.error && <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-sm text-danger">{media.error}</p>}
    </section>
  );
}