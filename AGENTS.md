Read [CLAUDE.md](CLAUDE.md). It is the working agreement for this repository, and it is named
for the tool that reads it automatically rather than because it is only for that tool.

## How work is done here

This repository follows the [lean agent](https://github.com/arnelirobles/lean-agent).

- Search open issues before filing. If one covers the area, add to its Covers list instead.
- One ticket is one agent pass, written agent-ready (the org's Agent-ready template): Goal, Where,
  Covers, Done when, Risks, Constraints, Out of scope.
- Scripts, not instructions: run what CI runs (`npm run typecheck`, `npm test`, `npm run build`),
  and `scripts/needs-review.sh` for what a reviewer should read. Anything reasoned through twice
  becomes a script.
- A bug fix ships with a test that failed before the fix.
- Every change gets an adversarial review by a separate agent, and findings go back to the agent
  that wrote the change.
- After a batch merges, run the retro and propose method changes with evidence.
