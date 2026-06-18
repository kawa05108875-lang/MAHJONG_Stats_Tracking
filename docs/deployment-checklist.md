# Deployment Checklist

Phase 10 deployment readiness checklist.

## Vercel

- Production project is connected to the GitHub repository.
- Build command is `npm run build`.
- Install command is `npm install`.
- Output directory is left as the Next.js default.
- Production deployment uses the `main` branch.

## Environment Variables

Set these variables in Vercel Production and Preview environments:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## Firebase

- Google sign-in is enabled in Firebase Authentication.
- Vercel production domain is added to Firebase Authentication authorized domains.
- Firestore Security Rules are deployed from `firestore.rules`.

## Smoke Test

- Log in with Google.
- Create or join a group.
- Create four players.
- Start a match.
- Save win, draw, and penalty hands.
- Finish a match and confirm results.
- Confirm ranking and player stats update.
- Delete a test match and confirm it disappears.
