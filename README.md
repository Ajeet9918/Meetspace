# MeetSpace

Secure video meetings on the MERN stack: accounts, invite links, a waiting room, host controls, WebRTC audio and video (mesh, up to 6 people), screen sharing and chat. Security is designed in, not added later.

## Contents
1. [Architecture](#architecture) · 2. [Local setup](#local-setup) · 3. [Deployment](#deployment) · 4. [Threat model](#threat-model) · 5. [Security checklist](#security-checklist) · 6. [Test plan](#test-plan) · 7. [Limitations and roadmap](#known-limitations-and-production-roadmap)

## Architecture
```
meetspace/
├── server/src/
│   ├── index.js, app.js          bootstrap; middleware order is security-relevant
│   ├── config/                   env.js (validated, fails closed), db.js
│   ├── middleware/               security (helmet, CORS, HTTPS), csrf, rateLimit, auth, validate, errorHandler
│   ├── models/                   User, RefreshToken, Meeting
│   ├── routes/                   auth.js, meetings.js
│   ├── services/                 password, tokens, keys, invites, roomTokens, device, turn, cleanup
│   ├── realtime/                 Socket.IO server, in-memory room state, event schemas, rate limits
│   └── utils/                    logger (redacting, audit), errors, validators
└── client/src/
    ├── lib/                      api.js, AuthContext, useRoom (signaling), useMedia (camera/mic/screen), mesh.js (WebRTC)
    ├── components/, pages/
```
```
Browser A ──REST (JWT + CSRF)──> Express ──> MongoDB          accounts, meetings, bans
Browser A ──WebSocket (room token)─> Socket.IO (signaling only, state in memory)
Browser A <══ DTLS-SRTP media, peer to peer ══> Browser B     (via coturn only if a direct path is impossible)
```
**How a guest gets in:** invite link → `POST /join` (invite signature, ban, lock and passcode checked) → room token (identity only, grants nothing) → WebSocket handshake → server puts them in the **waiting room** → host sends `waiting:admit` → server checks the host's role from its own state → guest is admitted and may exchange signaling. Every socket event is validated, rate limited and authorized against server-side state.

**SFU-ready:** `client/src/lib/mesh.js` is the only file that creates peer connections. Swapping to LiveKit or mediasoup means replacing that file.

## Local setup
Requires Node 20+ and MongoDB (local, Docker, or Atlas).
```bash
cd server && cp .env.example .env && npm install
npm run gen-secret          # paste into JWT_ACCESS_SECRET in .env; set MONGODB_URI
npm run dev                 # http://localhost:4000

cd client && npm install && npm run dev     # http://localhost:5173
```
Always browse via `http://localhost:5173` (the dev proxy keeps one origin, which `SameSite=Strict` cookies need). TURN is not needed locally.

## Deployment

### 1. Server environment (production)
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your Atlas or hosted MongoDB string, with a least-privilege user and an IP allowlist |
| `JWT_ACCESS_SECRET` | fresh value from `npm run gen-secret`. Never reuse a development value. Rotating it invalidates all sessions, invite links and room tokens |
| `CLIENT_ORIGINS` | `https://meet.example.com` (exact origin, `https` only) |
| `TRUST_PROXY` | `1` when behind Caddy, nginx or a load balancer |
| `COOKIE_SECURE` | `true` (enforced) |
| `TURN_URLS`, `TURN_SECRET` | required in production, see section 3 |
| `STUN_URLS` | defaults to a public STUN. Point it at your own coturn if you don't want a third party seeing client IPs |

The server refuses to start on placeholder or short secrets, wildcard origins, `http://` origins in production, or missing TURN settings.

### 2. HTTPS with Caddy (automatic certificates, HTTP→HTTPS redirect, WebSocket support)
```
meet.example.com {
	encode gzip
	reverse_proxy localhost:4000
}
```
```bash
cd client && npm ci && npm run build            # the server serves client/dist itself
cd ../server && npm ci --omit=dev
NODE_ENV=production node src/index.js           # run under pm2 or systemd so it restarts
```
With nginx instead: `proxy_pass http://127.0.0.1:4000;` plus `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header Host $host;`. The app sends HSTS and redirects HTTP itself.

### 3. TURN (coturn) for users behind strict NATs and firewalls
Use a separate DNS name (`turn.example.com`) and a Let's Encrypt certificate for it. Put the **same** secret in both places:
```
# server/.env
TURN_SECRET=<npm run gen-secret>
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
```
```
# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<same value as TURN_SECRET>
realm=turn.example.com
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
min-port=49160
max-port=49300
no-tlsv1
no-tlsv1_1
no-cli
no-multicast-peers
user-quota=12
total-quota=1200
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```
Firewall: **3478 UDP+TCP, 5349 TCP, 49160-49300 UDP**. Credentials are per participant, expire after 1 hour, and are handed out only to admitted participants. The secret never reaches the browser.

### 4. Pre-launch checklist
- [ ] Fresh `JWT_ACCESS_SECRET` and `TURN_SECRET`; `.env` is not committed (`git status`).
- [ ] `https://` works, `http://` redirects, response has `Strict-Transport-Security`.
- [ ] Test a call from two different networks (phone on mobile data and a laptop on Wi-Fi) to confirm TURN works.
- [ ] `npm run audit` in `server/` and `client/` (use `npm ci` so installs match the lockfile).
- [ ] MongoDB: network allowlist on, backups on, app user has only the `meetspace` database.
- [ ] Run the manual security tests below against the deployed site.

## Threat model
| Threat | Attack example | Mitigation implemented |
|---|---|---|
| Password guessing / credential stuffing | Script tries thousands of passwords | argon2id (64 MiB); 10 failed logins per IP per 15 min; account lockout after 5 failures for 15 min; identical error for every failure |
| User enumeration | Compare responses or timing for known vs unknown emails | Same 401 and message for unknown email, wrong password and locked account; a dummy hash is verified so timing matches. *Signup still reveals an existing email (see limitations)* |
| Stolen refresh token | Cookie copied from a compromised machine | httpOnly + SameSite=Strict cookie scoped to `/api/auth`; single-use rotation; replay revokes the whole session family; 30-day absolute cap; only hashes stored |
| Stolen access token | Script injected into the page | Held in memory only, never in storage; 15-minute life; algorithm, issuer and audience pinned |
| CSRF | Malicious site posts to the API using the victim's cookies | SameSite=Strict, Origin allowlist, double-submit token in an httpOnly cookie |
| NoSQL injection | `{"email":{"$gt":""}}` in a login body | Strict zod schemas reject non-strings and unknown keys; express-mongo-sanitize as backup |
| XSS via names, titles or chat | `<img src=x onerror=...>` | Control and bidi characters stripped, `<` `>` rejected in names; React escapes all output, no `dangerouslySetInnerHTML`, links never auto-linked; CSP forbids inline script |
| Clickjacking | Page embedded in a hostile iframe | CSP `frame-ancestors 'none'` |
| Guessing a meeting | Enumerating room ids or invite links | 128-bit random room id plus a 128-bit HMAC signature; every bad link returns the same generic 404; rate limits |
| Leaked invite link | Link forwarded too widely | Expiry, one-click regenerate (old link dies instantly), lock, waiting room, optional passcode |
| Passcode guessing | Brute-forcing a short code | argon2 hash; 8 failed tries per IP per meeting per 15 min; meeting-level lockout after 20 failures |
| Joining without admission | Opening a WebSocket directly, skipping the waiting room | Handshake requires a signed room token; admission is server-side state; waiting sockets are in no broadcast room and every event they send is refused |
| Forged host actions | A guest emits `waiting:admit` or `room:end` | Role is derived from the database at connect and checked from server state on every event; a validly signed token that merely claims "host" is rejected |
| Forged signaling / impersonation | Sending offers to people in another room, or spoofing `from` | Sender and recipient must both be admitted in the same room; the server stamps `from`; strict schemas; SDP size capped |
| Cross-site WebSocket hijacking | Hostile site opens a socket as the victim | Origin allowlist at upgrade; token travels in the handshake payload, not a cookie |
| Removed user returns | Rejoining after being removed | Device and account bans checked at join and at every socket connect. *Best-effort for anonymous guests* |
| Flooding | Chat spam, signal spam, join spam | Token buckets per socket; 10 forbidden or invalid events disconnect the socket; REST limiters; waiting-room cap; 10 KB JSON and 64 KB socket message limits |
| Resource exhaustion | One account creates endless rooms | 20 active meetings per user; idle meetings auto-end; ended meetings are deleted by a TTL index |
| TURN abuse | Using your TURN server as a free relay | HMAC credentials per participant, expire after 1 hour, only for admitted participants; coturn quotas; private address ranges denied |
| Eavesdropping on media | Network attacker captures calls | Browser DTLS-SRTP; your server never relays media; TURN sees only ciphertext |
| Secret leakage | Secrets in code, logs or the frontend | Environment variables only; startup validation; log redaction; no message content or tokens logged; TURN secret never leaves the server |
| Information leakage via errors | Stack traces in responses | Generic 500 with a request id; details only in server logs |
| Malicious dependency | Compromised package update | Exact pinned versions and lockfiles; `npm audit`; use `npm ci` in deployment |
| Silent protocol downgrade | Forcing plain HTTP | HTTP→HTTPS redirect, HSTS with preload, secure cookies enforced in production |
| Camera or mic abuse | Page captures media automatically | Capture only from a click handler; `Permissions-Policy` limits camera, mic and screen capture to our origin |

## Security checklist
- [x] HTTPS/WSS only in production, HTTP redirects, HSTS
- [x] DTLS-SRTP media; short-lived per-user TURN credentials; no TURN secret in the frontend
- [x] argon2id passwords; short-lived JWT; rotating refresh cookies (httpOnly, Secure, SameSite=Strict)
- [x] Socket handshake authentication; login rate limit, lockout, generic errors
- [x] 128-bit room ids; server-side authorization on every socket event; server-enforced waiting room
- [x] Host actions verified by role on the server; hashed passcode; max participants; lock; expiring and regenerable links; removed users blocked
- [x] helmet with strict CSP; strict CORS and WebSocket origin allowlist; schema validation everywhere; NoSQL injection guards
- [x] XSS-safe rendering; CSRF protection; REST and socket rate limits; payload size limits; permissions only on user action
- [x] Secrets in env with `.env.example`; no sensitive logging; minimal audit log (join, leave, remove, lock, end, mute)
- [x] Automatic cleanup of idle and ended rooms; pinned dependencies and `npm audit`; no stack traces to clients
- [ ] Recording: not implemented. If added it must require host permission and show a visible indicator to everyone.

## Test plan

### Automated (132 checks)
```bash
cd server && npm test
```
Runs against the real Express and Socket.IO code with only the database models replaced by in-memory stand-ins, so no MongoDB is needed. Covers every row of the manual list below.

### Manual security tests (run against a deployed or local instance)
| # | Test | Steps | Expected |
|---|---|---|---|
| 1 | Unauthorized room join | Open a socket to `/socket.io` with no token, with garbage, and with your login (access) token | Each is refused with `UNAUTHENTICATED` |
| 2 | Skipping the waiting room | Join as a guest, then send `signal`, `chat:send` and `waiting:admit` events before being admitted | All refused with `FORBIDDEN`; nothing reaches the room |
| 3 | Guessing an invite | Change one character of the signature, or use only the room id | The same generic "invite isn't valid" message as a random link |
| 4 | Forged host claim | Sign a token with `role: host` for a non-host user (needs the server secret) or edit a token | Rejected at the handshake |
| 5 | Forged signaling | As an admitted guest send `signal` with a `from` field, to a waiting person, to yourself, to a stranger's id, with a 40 KB SDP | `VALIDATION` or `FORBIDDEN` each time; repeated attempts disconnect the socket |
| 6 | XSS in chat and names | Chat `<img src=x onerror=alert(1)>`; sign up or join with that name | Chat shows it as plain text; the name is rejected; no alert; browser console shows no CSP violations |
| 7 | Expired TURN credentials | Take a credential's username (`<expiry>:<id>`) and wait past the expiry, or mint one with an old timestamp | coturn rejects the allocation; the server only ever issues credentials about 1 hour ahead |
| 8 | Brute-force login | 5 wrong passwords for one account, then the right one | Still `Invalid credentials`; after ~10 failures from one IP you get 429 |
| 9 | User enumeration | Log in with a real email + wrong password, then an unknown email | Identical status and message |
| 10 | CSRF | `curl -X POST https://HOST/api/auth/logout` with no token, and with a bad `Origin` | 403 both times |
| 11 | NoSQL injection | POST `{"email":{"$gt":""},"password":{"$gt":""}}` to `/api/auth/login` | 400 |
| 12 | Refresh token theft | Copy the refresh cookie, refresh once, wait 15 s, replay the old value | 401, and the whole session is revoked |
| 13 | Lock and ban | Lock the meeting, join from a private window; remove a guest, unlock, retry | Blocked in both cases |
| 14 | Old invite after regenerate | Click **New invite link**, open the old link | "This invite doesn't work" |
| 15 | Passcode | Wrong passcode 8 times from one browser | 429 for that IP on that meeting |
| 16 | Flood | Send 20 chat messages in a few seconds | `You're sending messages too fast` |
| 17 | TURN fallback | Join from two different networks | Video connects; in `chrome://webrtc-internals` a `relay` candidate pair is used when direct fails |
| 18 | Headers | `curl -sI https://HOST/` | `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, no `X-Powered-By` |

## Optional end-to-end encryption (future)
Today media is encrypted hop by hop (DTLS-SRTP), which is fine for a mesh. With an SFU or TURN relay, the relay could in principle see decrypted frames. **WebRTC Insertable Streams** (`RTCRtpScriptTransform`) fixes that:
1. A transform in a Worker encrypts each encoded audio or video frame with AES-GCM before it is packetized and decrypts incoming frames, so servers see only ciphertext.
2. Distribute keys through the existing signaling channel, wrapped per peer with an ECDH exchange (or use SFrame/MLS). Rotate keys when anyone joins or leaves.
3. Show a short fingerprint users can compare out of band so a malicious signaling server cannot swap keys unnoticed.
`mesh.js` is the single place to attach the transform.

## Known limitations and production roadmap
**Known limitations**
- **Signup reveals existing emails** (409). Hiding it needs email verification.
- **Account lockout can be abused** to lock someone out for 15 minutes; per-IP limits reduce this.
- **Anonymous device bans are best-effort:** clearing cookies gives a new device id. Lock the room or regenerate the link.
- **Host mute is cooperative**, because media is browser to browser. A modified client can ignore it.
- **Passcode lockout can be abused** to block guests for 10 minutes.
- **Access tokens survive logout-all** until they expire (at most 15 minutes).
- **Chat is not stored**, so late joiners miss earlier messages.
- **Room state is in one process.** A restart empties rooms; rate-limit counters are also per process.
- No email verification, password reset or MFA yet.

**To improve for production scale**
1. **SFU (LiveKit or mediasoup):** a mesh tops out around 6 people. An SFU scales to dozens, allows server-enforced mute and remove, simulcast and recording. Replace `mesh.js`.
2. **End-to-end encryption:** Insertable Streams or SFrame, as above.
3. **Redis:** Socket.IO Redis adapter, a Redis store for rate limits, and room state in Redis so several server instances can share rooms.
4. **Accounts:** email verification, password reset, MFA (TOTP or passkeys), and a breached-password check at signup.
5. **Operations:** ship audit logs to central storage with alerts on lockouts, token reuse and abuse disconnects; CSP violation reporting; automated backups; secrets manager; dependency scanning in CI (Dependabot or Renovate); an external penetration test.
6. **Recording (if wanted):** server-side with a visible indicator to everyone and host permission, per the requirements.

## Dependency hygiene
All versions are pinned exactly and lockfiles are committed. Install with `npm ci`. Run `npm run audit` in both folders before each release. At the time of writing the only open finding is two moderate, development-only advisories in `nodemon`'s dependency chain; they never ship to production, and the automatic fix would downgrade nodemon to a 2013 release, so it is intentionally not applied.


## Media server (LiveKit, up to 50 people)
Audio and video go through a LiveKit SFU: each person uploads one stream and the server forwards it, so a meeting can hold 50 admitted people (the host counts as one).
- **Access control:** the app issues a media token only to *admitted* participants (2-minute life, one room, one person, no data publishing). Waiting, removed and banned people can never obtain one. A dropped connection fetches a fresh token.
- **Enforced controls:** host mute, remove and end meeting are carried out on the media server. A muted person can unmute themselves.
- **Large rooms:** **Admit all** for the waiting room; the video grid shows 11 other people per page and only subscribes to video that is on screen.
- **Privacy change:** media is encrypted to the media server (DTLS-SRTP) rather than directly between browsers. For end-to-end encryption use LiveKit's E2EE option.

**Production setup:** run LiveKit on its own host (or use LiveKit Cloud) with `use_external_ip: true`, a 32+ character API secret, TLS (put the WebSocket behind Caddy on `wss://livekit.example.com`), and open TCP 7881 and the UDP media range from its config. LiveKit includes its own TURN, so coturn is optional. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; the server refuses to start in production without them. **Load-test before a large event** (`lk load-test`) and size bandwidth for roughly 1 Mbps per publisher in and several times that out.

| Threat | Attack example | Mitigation |
|---|---|---|
| Reaching media without admission | Connecting to the media server directly | Tokens only for admitted participants; 2-minute expiry; room-scoped identity; no data publishing |
| Removed person returns | Reusing an old media token | Short token life; removal kicks them from the media server; bans block new tokens |
| Over-capacity room | More than 50 people connect | Cap enforced by the app and again by the media server's room limit |