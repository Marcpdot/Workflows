# Privacy

## Personal model stays out of the public repo

**Status:** active  
**Evidence:** confirmed  
**Source:** Milestone 3 discussion; LTM env (`PERSONAL_CONTEXT_DIR`, gitignored DB paths)  
**Revisit when:** multi-device sync or encrypted-at-rest becomes required

Public Workflows holds **code and system knowledge** (`context/` project decisions, architecture). It does **not** hold a detailed personal biography, private preferences dump, or health/finance profile.

Long-term memory is exposed as an **API**; storage defaults to local/gitignored paths or an explicit directory outside the repo.

**Reason:** Repo may be public or shared; personal continuity should not depend on committing private facts. Agents and Build must not treat private profile files as normal source.

**Rejected alternatives:**

- **Commit `profile.md` with rich personal model into the repo** — convenient for local agents, unacceptable if the remote is public or broadly accessible.
- **No long-term memory at all until a separate private product exists** — over-blocking; API + private path is enough.

## Knowledge and voice privacy (M11–M18)

**Status:** active  
**Evidence:** confirmed  
**Source:** knowledge AGENTS privacy notes; M18 `VOICE_ALLOW_REMOTE_AUDIO`  
**Revisit when:** multi-device knowledge sync or cloud STT becomes daily path

- **Knowledge:** public repo holds schema, tools and smokes with **fake** labels only. Real project claims and conversation excerpts stay in the configured private PostgreSQL instance.
- **Voice:** prefer local STT (`VOICE_STT_PROVIDER=local` + command). Cloud STT/TTS **refuse** unless `VOICE_ALLOW_REMOTE_AUDIO=true`. TTS default off; no surprise mic (`VOICE_ENABLED` / explicit `--voice-once`).

**Reason:** Same personal-stack posture as LTM — useful APIs, private storage, remote leave-machine paths are opt-in and documented.
