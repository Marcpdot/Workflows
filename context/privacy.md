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
