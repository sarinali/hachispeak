# /fix-checks — Auto-fix failing CI checks

When invoked, continuously poll the current branch's GitHub Actions checks, fix failures as they appear, and push — looping until all checks pass or no more auto-fixes are possible.

## Steps

1. **Get current branch and PR**

   ```
   git branch --show-current
   gh pr view --json number,headRefName,statusCheckRollup
   ```

   Abort if on `main`.

2. **Poll loop** — repeat until all checks pass or nothing left to fix:

   a. Fetch check status:

   ```
   gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | {name,conclusion,status}'
   ```

   b. If any checks are `IN_PROGRESS`, wait 15s and re-poll (up to 10 minutes total).

   c. Collect all checks with `conclusion: FAILURE`.

3. **Map failures to fix commands**

   | Check name contains         | Fix command        |
   | --------------------------- | ------------------ |
   | `fmt`, `format`, `prettier` | `bun run fmt`      |
   | `lint`                      | `bun run lint:fix` |

   Skip checks with no known fix — report them to the user at the end.

4. **Apply fixes and push**

   Run each applicable fix command, then:

   ```
   git diff --quiet && echo "nothing changed" || (git add -A && git commit -m "chore: auto-fix CI checks" && git push)
   ```

   After pushing, go back to step 2 and continue polling the new run.

5. **Exit conditions**

   - All checks pass → report success.
   - No failing checks have a known fix → report the remaining failures and stop.
   - Same fix was already attempted twice with no change → stop to avoid a loop.

6. **Report**

   Tell the user which checks were auto-fixed across how many iterations, and which (if any) still need manual attention.

## Notes

- Never fix on `main` branch — warn and stop.
- If `gh pr view` fails (no open PR), run fix commands locally and report without pushing.
- Use `bun run <script>` not `npm run` — this project uses Bun.
