# GST Pro — Android app

Native React Native (Expo) client for GST Pro, covering what the website does:
business accounts get invoices (create, payment status, PDF share and print),
purchases, inventory, customers, vendors, payments, e-way bills, GST reports
(GSTR-1, GSTR-3B, HSN) and business settings; admins manage their users and
capacity; the superadmin manages admins, invitations and capacity requests.

Bills and bank statements are imported from a photo (on-device OCR), an image,
Excel, CSV or PDF (the server reads the PDF's text: POST /import/pdf-text). The link in admin-invite emails
opens the website to set a password before signing in here. There is no sign-up: admins create user accounts.

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

## Updates

Installed apps keep themselves current, the same way the CRM app does:

| What changed | How it reaches phones | What the user sees |
| --- | --- | --- |
| JavaScript (screens, forms, logic) | **Over the air.** On every merge to main that touches this folder, *Android app update (over the air)* publishes it | Downloaded in the background; it runs on the next launch, or after tapping **Restart** on the "An update is ready" bar |
| Native (a new `expo-*` or `react-native-*` module, permissions, plugins, Expo upgrade) | **New APK.** A merge to main that changes `package.json` or `app.json` runs *Android APK (internal)* and publishes the APK | An "Update available" dialog. **Update** downloads it and opens Android's installer |

Both are published to the repository's public `android-app` release. The
server reads it there: `/api/updates/manifest` serves the Expo Updates
protocol, and `/api/app/android/latest` (signed-in users) names the newest APK.

**Bump `expo.runtimeVersion` in `app.json` whenever you make a native change.**
A phone only takes an over-the-air update built for its own runtime version,
which keeps new JavaScript off an APK that lacks the native code it needs.
Phones on the old runtime are offered the new APK instead.

Apps installed from an APK built before the updater existed have no
update check: install one newer APK by hand, and every later one is offered.

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
