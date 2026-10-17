# Set up Ged in a project

Ged is how GedCode makes agent work trustworthy: the agent clarifies what you want before building,
another vendor's model checks the result against agreed criteria, and nothing lands without that
check passing. It works in any project once the project has a `.ged/` folder.

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
