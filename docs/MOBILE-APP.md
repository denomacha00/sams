# SAMS Mobile App

The **SAMS** native client (`packages/mobile`) complements the web app. Production web and API deploys are unchanged — `scripts/deploy-production.sh` does **not** build or ship mobile.

## Architecture

| Layer | Choice |
|-------|--------|
| Runtime | Expo SDK 52, React Native, TypeScript |
| Auth | `POST /api/v1/auth/login` → JWT in **expo-secure-store** |
| API client | Axios with refresh-token queue (same pattern as web `apiClient.ts`) |
| Attendance | Students scan session QR → `POST /api/v1/attendance/qr` (+ optional GPS) |

Default API base: `https://api.smart-managment.com/api/v1` (override with `EXPO_PUBLIC_API_URL`).

## Branding

Unique SAMS mark: indigo `#4F46E5` tile with calendar/book motif and emerald `#059669` checkmark (verified attendance). Assets live in `packages/mobile/assets/`:

- `icon.png` — 1024×1024 Expo app icon
- `adaptive-icon.png` — Android foreground
- `splash-icon.png` — splash screen
- `logo.png` — login / animated splash

`app.json`: name **SAMS**, slug **sams**, scheme **sams**.

## Screens (v1)

1. **Splash** — logo fade-in / scale animation  
2. **Login** — school code, username, password  
3. **Home** — avatar initials, welcome, role badge, sign out, role quick actions  
4. **Scan QR** — `expo-camera` + GPS (`expo-location`), student attendance  
5. **Placeholder** — navigable stubs for timetable, notifications, admin tools, etc.

Role menus match web personas (student, teacher, HOD, school admin).

## Run on a phone (Expo Go)

```bash
# From repo root
npm install
npm run build -w @sams/shared
cd packages/mobile
cp .env.example .env   # set EXPO_PUBLIC_API_URL if needed
npx expo start
```

- Install [Expo Go](https://expo.dev/go) on the device.  
- Same Wi‑Fi as the dev machine; use your PC **LAN IP** in `EXPO_PUBLIC_API_URL` when testing against a local backend (not `localhost`).  
- Scan the terminal QR code (Android: Expo Go; iOS: Camera → open in Expo Go).

OTP-only login accounts must use the web app until mobile OTP is added.

## Roadmap

| Priority | Item |
|----------|------|
| P1 | OTP login on mobile |
| P1 | Offline QR queue (parity with web PWA) |
| P2 | Push notifications (Expo Notifications) |
| P2 | Timetable and notifications native screens |
| P3 | EAS production builds (Play Store / App Store) |
| P3 | Teacher session QR display on mobile |

## Safety

- Mobile is an optional workspace package; CI/production deploy scripts for web/backend are unaffected.  
- Develop and test mobile locally while production web stays up.

See also `packages/mobile/README.md` for install and EAS build notes.
