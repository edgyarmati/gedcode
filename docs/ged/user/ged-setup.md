# Set up Ged in a project

Ged is how GedCode makes agent work trustworthy: the agent clarifies what you want before building,
another vendor's model checks the result against agreed criteria, and independent review is
required by default. It works in any project once the project has a `.ged/` folder.

## Set it up

Choose one:

- **Set up Ged** beside the project name at the top of a thread. Once set up, it shows **Ged**
  with a green dot.
- **Project settings → Ged → Set up…**
- **Command palette → Set up Ged in _project_** while a thread in that project is open
- Ask an agent in the project to set up Ged. In the first thread in a project without Ged, the
  agent asks you once whether to set it up.

GedCode lists the files it will add and waits for you to confirm. It only adds files: anything
already in `.ged/` stays exactly as it is, so running setup again is safe. Setting up needs write
access to files on the environment.

## After setup

- Fill in the **Checks** table in `.ged/STANDARDS.md` with your project's format, lint, typecheck
  and test commands. Agents run these to prove a change works.
- Start a thread at the project root and describe the work. The agent asks questions until the
  intent is clear, records agreed terms and decisions in `.ged/`, then does the work.
- To prefer particular models, tell the agent. It records them in `.ged/model-notes.md`.
- Commit the `.ged/` folder. Verdicts in `.ged/verdicts/` stay local and are ignored by Git.

The land gate, `.ged/bin/land-gate.sh`, needs Node.js on the `PATH` to run. To check every push,
use it as a Git pre-push hook; see [the Ged workflow](../workflow.md#the-land-gate).

## Review preferences and existing projects

You can explicitly ask to skip independent reviews for this project or just the current change.
The agent infers scope or asks one question when unclear. Project skip persists locally across
threads and linked worktrees, not clones or other environments; change skip binds the full branch
and final clean commit, and expires for any different commit. Normal checks remain required.
Skipped review is reported as **SKIPPED**, never passed.

Ask to require reviews again to reverse it. Project reset clears all local exemptions; change
reset clears only that branch and can inherit project skip. Missing policy means required;
invalid policy blocks and can be repaired with explicit project reset.

New setup includes a compatible land gate. For an existing project, ask the agent to preview and
explicitly apply `ged_review_gate_update`: it upgrades only the exact stock legacy gate, preserving
customized scripts. Running setup again still leaves existing files untouched. Custom gates need
manual integration; see [review preferences and gate upgrades](../workflow.md#choosing-whether-to-require-independent-review).
