# Boxedables site

Test site for the Boxedables customizer: https://boxedables.com (also https://boxedables-site.obukusb.workers.dev). Locked with Cloudflare Access.

## How it fits together

- `src/customizer.html`: a copy of the live claude.ai page (the design build).
- `public/bridge.js`: gives the page the same features it has on claude.ai (database, accounts, character files, downloads), using Firebase.
- `public/firebase-config.js`: the Firebase project settings (public by design).
- `tools/build.py`: makes `public/index.html` from `src/customizer.html`.
- `firestore.rules`: who can read and write what. Paste into Firebase → Firestore → Rules → Publish after each change.
- `wrangler.jsonc`: Cloudflare settings. Every push to `main` updates the test site.

## Bringing over changes from claude.ai

1. Save the latest claude.ai page as `src/customizer.html`.
2. Run `python3 tools/build.py`.
3. Commit and push.

## Making someone an admin

Firebase → Firestore → Data → start a collection `admins`, add a document whose ID is their user ID (Authentication → Users → User UID). Any field is fine, for example `ok: true`.

## Differences from the claude.ai page

- Members sign in with Google or email (Patreon login comes later).
- Characters and Admin settings live in Firebase, so they start empty here.
- Uploaded character files are stored in Firestore in pieces (Storage needs the paid plan).
