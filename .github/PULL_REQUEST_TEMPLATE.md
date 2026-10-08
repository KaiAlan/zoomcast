Describe the user-visible problem and resulting behavior.

Validation:

- Relevant tests and native Windows checks:
- For user-visible changes, update `docs/releases/unreleased.md` and run `npm run notes:write` so `CHANGELOG.md` stays current.
- For a release, review Highlights, detailed changes and Upgrade notes against the changes since the previous tag, then run `npm run notes:check`.
