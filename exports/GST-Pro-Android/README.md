# GST Pro — Android app

Native React Native (Expo) client for GST Pro. Business ("user") accounts can
sign in and see the dashboard, invoices and customers. Admin tools, sign-up and
password resets stay on the website for now.

It talks to the API with a bearer token kept in the device keystore
(`expo-secure-store`); the server skips its browser CSRF check for bearer
requests and `/auth/logout` revokes the token.

## Building an APK (GitHub)

Run **Actions → Android APK (internal) → Run workflow**, or push a
`release/android-*` branch. The signed arm64 APK is attached to the run.

One-time setup:

- Repository variable `ANDROID_BACKEND_HOST`: the published GST Pro hostname,
  e.g. `billing.example.com` (no `https://`, no `/api`). The run's
  `backend_host` input overrides it.
- Environment `android-release` with secrets `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD` and optionally `ANDROID_KEY_PASSWORD`. The key
  alias defaults to `gstpro` (override with variable `ANDROID_KEY_ALIAS`).
  Create a key with
  `keytool -genkeypair -v -keystore gstpro.jks -alias gstpro -keyalg RSA -keysize 2048 -validity 10000`
  and store `base64 -w0 gstpro.jks` as the first secret. Keep the keystore:
  updates must be signed with the same key.
- The backend's `ALLOWED_ORIGINS` needs no change: the app sends no `Origin`.

Pull requests touching this folder get an unsigned compile check.

## Local development

```
npm ci
cp .env.example .env   # set EXPO_PUBLIC_DOMAIN
npm run typecheck
npx expo start         # or: npm run android (needs Android Studio)
```

This folder is a standalone npm project, outside the pnpm workspace.
`android/app/build.gradle` is hand-maintained for release signing;
`node scripts/refresh-android-build.mjs <host>` (from the repo root) regenerates
the rest of `android/` and keeps it.
