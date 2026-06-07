# /fix-checks — Auto-fix failing CI checks

When invoked, poll the current branch's GitHub Actions checks, identify auto-fixable failures, apply fixes, and push.

## Steps

1. **Get current branch and PR**

   ```
   git branch --show-current
   gh pr view --json number,headRefName,statusCheckRollup
   ```

2. **Find failing checks**
   Look at `statusCheckRollup` for checks with `conclusion: FAILURE` or `status: IN_PROGRESS`.
   Wait for in-progress checks to complete before acting (poll every 15s, up to 3 minutes).

3. **Map failures to fix commands**
   | Check name contains | Fix command |
   |---|---|
   | `fmt`, `format`, `prettier` | `npm run fmt` |
   | `lint` | `npm run lint:fix` |

   Only proceed with checks that have a known fix. Report unknown failures to the user without attempting a fix.

4. **Apply fixes**
   Run each applicable fix command. Then:

   ```
   git diff --quiet && echo "nothing to fix" && exit 0
   git add -A
   git commit -m "chore: auto-fix CI checks"
   git push
   ```

5. **Report**
   Tell the user which checks were fixed and pushed, and which (if any) still need manual attention.

## Notes

- Never fix on `main` branch — warn the user and stop.
- If `gh pr view` fails (no open PR), run fix commands locally and report results without pushing.
