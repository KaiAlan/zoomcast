# Installers and releases

## Download

Download `zoomcast-Setup-<version>.exe` from the [latest release](https://github.com/KaiAlan/zoomcast/releases/latest). The Windows x64 installer includes FFmpeg and ffprobe. Other assets support updates or provide corresponding media source; users do not need them to install.

## Updates

Version 0.1.2 and later check public GitHub releases without an account or access token. Versions 0.1.0 and 0.1.1 need one manual upgrade to the latest version. After that, use Update and Restart to update.

The next release checks automatically once, five seconds after opening the app. A new published stable release appears in a quiet in-app notice in the editor, idle recorder and Settings. There are no Windows notifications, hourly checks or wake-up checks. Users can still choose Check for updates in Settings. Publishing a draft makes it discoverable the next time someone opens Zoomcast; drafts and prereleases are excluded.

Each installed version shows a short What's new card on the workspace and idle recorder until Got it is clicked. Dismissal persists across restarts and updates every open window. Settings always retains the summary and its link to the detailed GitHub release. The first launch also shows the installed version's highlights.

Updates download on request. Restart waits for recording and export to finish and saves open projects before silently installing and reopening the app.

## Build and validate

Use native Windows Node.js 24 and MSYS2 MINGW64. See [media build instructions](../../build/FFMPEG-SOURCES.md).

```powershell
npm ci
npm run notes:check
npm run typecheck
npm run lint
npm test
npm run dist
npm run verify:release
npm run verify:packaged
npm run verify:project-save
npm run verify:feedback
npm run verify:updates
npm run verify:update-notices
```

Run installed upgrade and capture/export validation on Windows before shipping changes to those paths. The installer is currently unsigned.

The project-save guard checks deleted and empty zoom timelines, audio edits, Ctrl+S, disk failures, retry, and switching recordings through the native editor and real save IPC. The feedback guard checks the form and native IPC, report encoding, long-report fallback, keyboard behavior, and browser failure/retry. It captures browser launches and clipboard writes without submitting reports or changing the user's clipboard.

## Ship

1. Keep versions in 0.1.x until the maintainer approves a new minor version.
2. Maintain [unreleased.md](unreleased.md) as user-visible changes land. When preparing a version, move those changes into `<version>.md`, use `# Zoomcast <version>` as the title, and add Upgrade notes. Update package.json and package-lock.json together (`npm version <version> --no-git-tag-version`). Review the entries against the changes since the last tag, including removed features, compatibility changes and known limitations.
3. Run `npm run notes:write` and commit the updated [CHANGELOG.md](../../CHANGELOG.md). `npm run notes:check` blocks mismatched versions/tags, missing summaries or details, unfinished placeholders and a stale changelog. CI and release builds both run this gate.
4. Push the matching v<version> tag after CI passes. The release workflow builds and validates a draft release, using the prepared notes for the GitHub body. Manual workflow runs build a candidate without publishing. The old branch-specific 0.1.2 publishing path has been retired.
5. Review the installer and publish the draft. Keep the installer, blockmap, latest.yml, matching media source archive, and source checksum together. Do not replace an installer after generating its metadata.

## Release note format

Each version file has 1–5 plain-text bullets under `## Highlights` (13–240 characters each), at least one detailed `## Added`, `## Changed`, `## Improved` or `## Fixed` section, and `## Upgrade notes`. Use [template.md](template.md) when starting a new file. Only include sections relevant to that version. Describe the user-visible behavior and include any material limitations. The gate verifies structure and consistency; maintainers still review completeness and accuracy.

`npm run build` validates the changelog and prepares `build/release-notes.md`. Electron Builder includes these detailed notes in latest.yml. The same build embeds only the current version and Highlights in the app. The GitHub workflow uses this prepared Markdown as the release body, and `verify:release` checks metadata and packaged highlights against the source. Editing an older release's source file does not retroactively edit its published GitHub body.

`verify:update-notices` drives the normal installed startup path with a simulated provider and intercepted browser opens. It verifies the single automatic check, incoming and installed summaries, correct release links, no Windows notifications or wake checks, dismissal persistence and cross-window updates. `verify:updates` separately checks downloads, progress, busy recording/export guards and project saves before restart. Neither harness publishes a release or downloads an installer.

## Licenses

Zoomcast's own code uses the [MIT License](../../LICENSE). Retain [third-party notices](../../THIRD_PARTY_NOTICES.md) and matching GPL media sources with each release. Keep corresponding-source archives available for older distributed versions.
