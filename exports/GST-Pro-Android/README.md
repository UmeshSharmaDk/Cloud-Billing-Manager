# GST Pro — Android app

Native React Native (Expo) client for GST Pro, covering what the website does:
business accounts get invoices (create, payment status, PDF share and print),
purchases, inventory, customers, vendors, payments, e-way bills, GST reports
(GSTR-1, GSTR-3B, HSN) and business settings; admins manage their users and
capacity; the superadmin manages admins, invitations and capacity requests.

Two website-only pieces remain: importing a purchase bill from a PDF or photo,
and the links in sign-up and admin-invite emails, which open the website to set
a password before signing in here.

It talks to the API with a bearer token kept in the device keystore
(`expo-secure-store`); the server skips its browser CSRF check for bearer
requests and `/auth/logout` revokes the token.

## Building an APK (GitHub)

Run **Actions → Android APK (internal) → Run workflow**, or push a
`release/android-*` branch. The signed arm64 APK is attached to the run.

One-time setup:

- The app talks to `billing.myindiatrips.com` by default. Set the repository
  variable `ANDROID_BACKEND_HOST`, or the run's `backend_host` input, to point a
  build elsewhere (hostname only, no `https://` or `/api`).
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
