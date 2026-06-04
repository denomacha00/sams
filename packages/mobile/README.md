# SAMS Mobile

Native mobile client for **SAMS** (Smart Attendance Management System). Built with **Expo SDK 52** and TypeScript. Uses the same REST API as the web app (`/api/v1`).

This package is **independent of production web deploys** — `scripts/deploy-production.sh` does not build or ship mobile.

## Logo assets

| File | Use |
|------|-----|
| `assets/icon.png` | 1024×1024 app icon (Expo / stores) |
| `assets/adaptive-icon.png` | Android adaptive icon foreground |
| `assets/splash-icon.png` | Splash screen image |
| `assets/logo.png` | Login and splash UI |

Brand colors: indigo `#4F46E5`, emerald `#059669`, slate neutrals (see `src/theme/colors.ts`).

## Prerequisites

- Node.js 20+
- From repo root: `npm install` (workspace includes `@sams/mobile`)
- [Expo Go](https://expo.dev/go) on your phone, or Android Studio / Xcode for dev builds

## Configure API URL

```bash
cd packages/mobile
cp .env.example .env
```

Set `EXPO_PUBLIC_API_URL`:

| Variable | Environment | Example |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | Production | `https://api.smart-managment.com/api/v1` |
| `EXPO_PUBLIC_API_URL` | Web parity (app host) | `https://app.smart-managment.com/api/v1` |
| `EXPO_PUBLIC_API_URL` | Local backend | `http://YOUR_LAN_IP:3001/api/v1` (not `localhost` on a physical device) |

Teacher/HOD **Face attendance** uses the device camera (`expo-camera`) and the same `POST /biometric/match` API as the web app. Start the session on web first.

## Run (development)

From **repo root**:

```bash
npm install
npm run build -w @sams/shared
cd packages/mobile
npx expo start
```

Or:

```bash
npm run start -w @sams/mobile
```

Scan the QR code with **Expo Go** (Android) or the Camera app (iOS).

## Build APK (preview / internal)

```bash
cd packages/mobile
npx expo prebuild --platform android
npx expo run:android
```

For store-ready builds, use [EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npm install -g eas-cli
eas build:configure
eas build --platform android --profile preview
```

Keep EAS credentials and signing keys in your ops notes; they are not part of the web VPS deploy.

## Screens

| Screen | Description |
|--------|-------------|
| Splash | Logo animation on dark slate |
| Login | School code, username, password → `POST /auth/login` |
| Home | Avatar, welcome, role badge, quick actions per role |
| Scan QR | Camera QR scanner → `POST /attendance/qr` + GPS |
| Placeholder | Navigation targets for upcoming native flows |

Tokens are stored with **expo-secure-store**. Refresh tokens use the same interceptor pattern as the web client.

## Does not affect the web app

- No change to nginx, PM2, or `deploy-production.sh` for mobile.
- Web and API keep running while you develop mobile locally.
- See `docs/MOBILE-APP.md` for architecture and roadmap.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Network error on login | Use LAN IP in `EXPO_PUBLIC_API_URL`; ensure backend is reachable |
| OTP required | Use web app for OTP login in v1 |
| `@sams/shared` not found | Run `npm run build -w @sams/shared` from repo root |
| Camera denied | Enable camera permission in OS settings for Expo Go |
