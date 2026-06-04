# Denis — Attendance & Biometric Manual Test (VPS)

Run after deploy (`prisma migrate deploy`, backend + frontend build, nginx reload).

## Prerequisites

- School **not suspended**; test users: teacher, HOD (with timetable slot today), 2 students (one with **GPS attendance permission** enabled in User Management)
- Professional/Enterprise plan if testing face scan
- HTTPS or localhost for geolocation + WebAuthn

---

## 1. Teacher — session without GPS

1. Teacher → **Sign In Students** → select today’s class
2. Turn **Require GPS (QR scan)** **OFF** → **Start Session**
3. Student (web **Scan QR** or mobile) scans QR → expect **success**
4. Teacher → **End Session**

## 2. Teacher — session with GPS + radius

1. Start session with **Require GPS ON**, radius e.g. **80m** (allow browser location)
2. Student **on same network/location** scans → **success**
3. Optional: student far away without permission → `GPS_OUT_OF_RANGE`

## 3. Student GPS permission (outside radius)

1. Admin/HOD → **Manage Users** → edit student → enable **GPS attendance permission**
2. Teacher starts session with GPS ON and small radius (50m)
3. That student scans from “far” location → **success** (exempt)
4. Other student without permission → **rejected** if out of range

## 4. Link attendance

1. Teacher active session → **Share Attendance Link**
2. Test **Require GPS ON** + radius → student opens link logged in
3. Regenerate with **Require GPS OFF** → student signs in without location prompt

## 5. Manual attendance

1. Teacher → **Mark Attendance** → pick active session → mark present/late/absent

## 6. Biometric login

1. Teacher → **Settings** → register fingerprint/passkey
2. Log out → **Sign in with Fingerprint** → dashboard loads

## 7. HOD as teacher

1. HOD on timetable for a class today → **Sign In Students** (dashboard button + Attendance section)
2. Start session, show QR; student scan works
3. **Mark Attendance** / **Face Scan** (if licensed) — no 403 Forbidden

## 8. Suspend sanity (do not regress 6753c1d0)

1. Super admin suspend school → logged-in user kicked / cannot refresh
2. Unsuspend → user **logs in again** (not auto-restored session)

---

## VPS deploy (quick)

```bash
cd /path/to/SAMS
git pull origin main
cd packages/backend && npx prisma migrate deploy
cd ../..
npm ci
npm run build -w @sams/shared
npm run build -w @sams/backend
npm run build -w @sams/frontend
sudo systemctl restart sams-api   # or your unit name
sudo nginx -s reload
```

Verify: `curl -s https://app.smart-managment.com/health | head`

Record pass/fail per section in your ops log.
