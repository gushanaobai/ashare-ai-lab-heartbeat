# A-share heartbeat runner

This public GitHub Actions repository runs the site's paper-trading engine while your browser is closed.

## Setup

1. Create a **public** GitHub repository, for example `ashare-ai-lab-heartbeat`.
2. Add `.github/workflows/heartbeat.yml` using the file in this folder. On GitHub:
   - Add file → Create new file
   - Name it `.github/workflows/heartbeat.yml`
   - Paste the workflow content and commit.
3. Add `runner.mjs` at the repository root and commit it.
4. Open **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `CRON_TOKEN`
   - Value: the 48-character token stored in the local token file
   Do not put the token in a source file.
5. Open **Actions → A-share heartbeat → Run workflow**.
   - Manual runs perform one `tick` and exit (the market is closed on weekends).
6. The scheduled workflow runs Monday–Friday at 09:10 Asia/Shanghai and keeps a 10-second loop until 15:05, calling `tick`, and `decide`/`review` when the engine requests them.

## Notes

- Public repositories use free GitHub Actions minutes. A private repository will not have enough free minutes for a ~6-hour trading-day job.
- GitHub may delay a scheduled job by a few minutes; the runner starts early and waits for the pre-open window.
- Chinese public holidays are not in the schedule; on a holiday the engine receives a closed-market tick and does not trade.
- The site URL is public and intentionally in the workflow. The `CRON_TOKEN` must only be stored as an Actions Secret.
- The runner sends the site `Origin` and `x-ashare-cron` headers required by the Sites gateway and the engine.
