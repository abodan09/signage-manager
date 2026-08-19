# Cutting a release

Every step here was verified end to end on v1.9.0 and v1.9.1 (2026-08-18/19).
The traps are listed because each one has actually bitten.

## The landing page has TWO copies

`docs/index.html` is the deployed site (GitHub Pages, `docs/CNAME` →
signage.frozenbit.eu). It publishes **on push to main**, not on release.

There is a **second copy as a Claude artifact**:
<https://claude.ai/code/artifact/d7a9e285-41a5-4e7d-8856-661ab2b7ed7c>

They are independent. Editing one does not touch the other, and they have
already drifted: the artifact embeds a base64 Inter font it needs (artifacts
cannot fetch external fonts — the CSP blocks them) which the deployed page does
not carry. **Never sync them by copying one file over the other** — insert the
same changelog entry into each.

Because `docs/` deploys on push while releases need a tag, adding the changelog
entry before the release exists puts the site in the position of advertising a
version nobody can download. Either do both in the same sitting, or add the
entry last.

## Steps

1. Bump `version` in `package.json`.
2. Add the changelog entry to `docs/index.html` and move the `Latest` badge
   onto it — the entry markup is `<details class="log latest" open>` with a
   `<summary><span class="log-ver">vX.Y.Z</span><span class="log-tag">Latest</span></summary>`.
   Take the badge off the previous entry, or two will claim to be latest.
3. Add the **same entry to the artifact** and republish it to the same URL.
4. `npm run build && npm test` — the suite runs against `dist/`, so build first.
5. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.
6. CI (`.github/workflows/release.yml`, ~4 min) builds all four platforms and
   publishes the release. `workflow_dispatch` on main runs the builds *without*
   publishing, if you want to check them before tagging.
7. **CI publishes the release with an EMPTY body.** `src/main/updater.ts`
   scrapes `- ` bullet lines out of that body for the in-app "what changed"
   screen, so it stays blank unless you follow with:
   `gh release edit vX.Y.Z --notes-file <file>`
   Use plain `- ` bullets. Lines that are not bullets do not reach the app.

## Verify, in this order

```sh
gh release view vX.Y.Z --json assets -q '.assets[].name'   # 7 assets incl. latest.yml
curl -sSL https://github.com/abodan09/signage-manager/releases/latest/download/latest.yml | head -3
for p in windows android webos tizen; do curl -sS -o /dev/null -w "$p %{redirect_url}\n" \
  https://signage-api.frozenbit.eu/d/$p; done
curl -sS https://signage.frozenbit.eu/ | grep -o 'log-ver">vX\.Y\.Z'
```

`latest.yml` is what installed copies poll, and it carries the sha512 the
updater checks the download against. It is published by **electron-builder**
during `npm run dist` (it has `GH_TOKEN`), not by the workflow's upload globs —
which is why the release carries two `.exe` assets under different names. If
`latest.yml` ever goes missing, updates keep working but stop being verified.

## Do not forget

- **Back up `f:\vscode_programs\signage-manager-secrets\`.** It holds the
  Android signing keystore. Lose it and no future APK can update over an
  installed one.
- Screens do not need updating for a release. New app boards render on the
  manager and arrive over the network; the TV apps are restamped only to keep
  the fleet on one version number. Say so in the notes, or operators go
  re-flashing panels for nothing.
- Local `npm run dist` on this PC needs the `7za` wrapper; `npm install` wipes
  it. CI is unaffected.
