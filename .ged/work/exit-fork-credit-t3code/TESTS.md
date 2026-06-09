# TESTS

- `bun fmt`
- focused grep confirms public upstream credit mentions `pingdotgg/t3code`.
- `git remote -v` still includes upstream `https://github.com/pingdotgg/t3code.git`.
- After GitHub UI detach: `gh api repos/edgyarmati/gedcode --jq .fork` returns `false`.
