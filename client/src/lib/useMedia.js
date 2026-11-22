import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';

const ERRORS = {
  NotAllowedError: 'Permission was blocked. Allow camera and microphone for this site in your browser settings.',
  NotFoundError: 'No camera or microphone was found.',
  NotReadableError: 'Your camera or microphone is being used by another app.',
};
const EVENTS = [
  RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished,
  RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
];

/**
 * Camera, mic and screen share through the media server (SFU). Each person uploads ONE stream and the server
 * forwards it, so rooms scale to 50 people. Capture starts only from a click. The server issues the media token
 * only to admitted participants, so the waiting room and bans are enforced before anyone can reach media.
 */
export function useMedia(room) {
  const { phase, you, emit, muteSeq } = room;
  const myId = you?.id;
  const [remote, setRemote] = useState({}); // participant id -> { main, sharing, audio }
  const [local, setLocal] = useState({ main: null, mic: false, cam: false, sharing: false, hasMedia: false });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const lk = useRef(null);

  const readRemote = useCallback(() => {
    const next = {};
    lk.current?.remoteParticipants.forEach((part) => {
      let cam = null; let screen = null; let audio = null;
      part.trackPublications.forEach((pub) => {
        if (!pub.isSubscribed || !pub.track) return;
        if (pub.source === Track.Source.Camera && !pub.isMuted) cam = pub.track;
        else if (pub.source === Track.Source.ScreenShare) screen = pub.track;
        else if (pub.source === Track.Source.Microphone) audio = pub.track;
      });
      next[part.identity] = { main: screen ?? cam, sharing: Boolean(screen), audio };
    });
    setRemote(next);
  }, []);

  const readLocal = useCallback(() => {
    const lp = lk.current?.localParticipant;
    if (!lp) return;
    const cam = lp.getTrackPublication(Track.Source.Camera);
    const scr = lp.getTrackPublication(Track.Source.ScreenShare);
    const mic = lp.getTrackPublication(Track.Source.Microphone);
    const camOn = Boolean(cam?.track && !cam.isMuted);
    const micOn = Boolean(mic?.track && !mic.isMuted);
    setLocal({ main: scr?.track ?? (camOn ? cam.track : null), mic: micOn, cam: camOn, sharing: Boolean(scr?.track), hasMedia: Boolean(mic?.track || cam?.track) });
    emit('media:state', { mic: micOn });
  }, [emit]);

  useEffect(() => {
    if (phase !== 'in' || !myId) return undefined;
    let closed = false;
    const r = new Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: VideoPresets.h360 }, publishDefaults: { simulcast: true } });
    lk.current = r;
    const refresh = () => { readRemote(); readLocal(); };
    EVENTS.forEach((ev) => r.on(ev, refresh));
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!r.canPlaybackAudio));

    async function connect(attempt = 0) {
      setStatus('connecting');
      const res = await emit('media:token');
      if (closed) return;
      if (!res.ok) {
        setStatus('failed');
        setError(res.code === 'MEDIA_NOT_CONFIGURED' ? 'The media server is not set up yet.' : 'Could not get access to the media server.');
        return;
      }
      try {
        await r.connect(res.url, res.token);
        if (closed) return;
        setStatus('connected');
        setError('');
        refresh();
      } catch {
        if (closed) return;
        if (attempt < 2) setTimeout(() => connect(attempt + 1), 2000);
        else { setStatus('failed'); setError('Could not connect to the media server.'); }
      }
    }
    // A dropped media connection asks for a FRESH token (they expire in 2 minutes), so a removed person cannot reuse one.
    r.on(RoomEvent.Disconnected, () => { if (!closed) setTimeout(() => !closed && connect(0), 1500); });
    connect();

    return () => { closed = true; r.disconnect(); lk.current = null; setRemote({}); setStatus('idle'); };
  }, [phase, myId, emit, readRemote, readLocal]);

  const fail = (e) => setError(ERRORS[e.name] || 'Could not start your camera or microphone.');

  const start = useCallback(async () => {
    setError('');
    const lp = lk.current?.localParticipant;
    if (!lp || status !== 'connected') return setError('Still connecting to the media server. Try again in a moment.');
    try { await lp.setMicrophoneEnabled(true); } catch (e) { return fail(e); }
    try { await lp.setCameraEnabled(true); } catch { /* no camera: audio only */ }
    return readLocal();
  }, [status, readLocal]);

  const toggleMic = useCallback(async () => {
    setNotice('');
    try { await lk.current?.localParticipant.setMicrophoneEnabled(!local.mic); } catch (e) { fail(e); }
    readLocal();
  }, [local.mic, readLocal]);

  // Turning the camera off stops it, so the camera light really goes out.
  const toggleCam = useCallback(async () => {
    setError('');
    try { await lk.current?.localParticipant.setCameraEnabled(!local.cam); } catch (e) { fail(e); }
    readLocal();
  }, [local.cam, readLocal]);

  const toggleShare = useCallback(async () => {
    setError('');
    try { await lk.current?.localParticipant.setScreenShareEnabled(!local.sharing, { audio: false, contentHint: 'detail' }); }
    catch { setError('Screen sharing was cancelled or blocked.'); }
    readLocal();
  }, [local.sharing, readLocal]);

  // The media server has already muted us; this just explains it. Speaking again is always our own choice.
  useEffect(() => { if (muteSeq) setNotice('The host muted you. Unmute when you’re ready to speak.'); }, [muteSeq]);

  const enableAudio = useCallback(() => lk.current?.startAudio().then(() => setAudioBlocked(false)), []);

  return { remote, local, status, error, notice, audioBlocked, enableAudio, started: local.hasMedia, start, toggleMic, toggleCam, toggleShare };
}