# Compute policy

## Budget-aware tiering over pure routing (Milestone 7)

**Status:** active  
**Evidence:** confirmed  
**Source:** M7 commit `fce312c`; `Orchestrator/src/policy/`; `POLICY_ENABLED` default false  

Rule routing alone cannot **cap cost**. Compute policy sits before model selection: session/daily budgets, optional mid tier, force flags, and a recorded reason. When `POLICY_ENABLED` is false, behavior matches the prior router-only path.

**Reason:** Frontier and mid-tier spend should be intentional. Operators need budgets and an explicit opt-in before habitual paid traffic.

**Rejected alternatives:**

- **Only hardcode more router rules** — cannot enforce remaining budget or daily USD caps.
- **Policy always on with aggressive defaults** — would change M0 behavior unexpectedly; default off preserves the known path.
- **Dynamic vendor price APIs / multi-cloud arbitrage** — out of scope for the shell.

See also [routing.md](routing.md) (task/complexity rules) and [observability.md](observability.md) (policy reason on events).
