export const GRILLING = `# Grilling playbook

Use this before non-trivial work, or whenever the user asks to be grilled. The goal is that you and
the user understand the request the same way, and that what you settle survives this chat.

1. Read \`.ged/CONTEXT-MAP.md\` and \`.ged/DECISIONS.md\` first, so you use the project's terms and do
   not reopen settled decisions.
2. Interview the user about every branch of the decision tree, resolving dependencies one by one.
   Ask **one question at a time** and wait for the answer. With each question, give your
   recommended answer and why.
3. If a fact can be found in the code, the tools or the environment, look it up instead of asking.
   Decisions belong to the user; put each one to them.
4. Do not act on any of it until the user confirms you have reached a shared understanding.
5. Then record it:
   - New or sharpened project terms go in \`.ged/CONTEXT-MAP.md\`, one line each.
   - Real decisions (ones a future maintainer would get wrong without the record) go in
     \`.ged/DECISIONS.md\`: a dated heading, the decision, and the reason. Not every answer is a
     decision; most are just the task.
   - Model preferences the user stated go in \`.ged/model-notes.md\`.
6. End with the acceptance criteria you would hand a verifier, and continue with the lead playbook.
`;
