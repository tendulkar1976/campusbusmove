# Firebase Setup & Verification Guide - CampusMove

## 🔧 Phase 1: Firebase Realtime DB Rules Setup

### Step 1: Navigate to Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **project-8ef56e2a-0de7-492f-b49**
3. Click **Realtime Database** (left sidebar)
4. Click **Rules** tab at the top

### Step 2: Apply These Rules
Replace the current rules with:

```json
{
  "rules": {
    "routes": {
      "{routeId}": {
        "live": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      }
    },
    ".read": false,
    ".write": false
  }
}
```

This allows:
- ✅ Any authenticated user to READ/WRITE GPS location under `routes/{routeId}/live`
- ✅ All other paths are blocked (security)

### Step 3: Click Publish
- Click **Publish** button
- Confirm in dialog

---

## 🔍 Phase 2: Verify Firestore Collections

### Check Existing Collections
1. Go to **Firestore Database** (left sidebar)
2. Verify these collections exist:
   - **users** - User profiles with role (student/driver/admin)
   - **routes** - Route definitions
   - **trips** - Driver trip history (may be empty initially)

### If collections are missing:
The app will auto-create them when:
- A user registers (creates `users/{uid}`)
- A driver starts a trip (creates `trips/{tripId}`)
- Admin adds a route (creates `routes/{routeId}`)

---

## 🚀 Phase 3: Local Testing Setup

### Prerequisites
- Node.js 16+ installed
- Git installed
- Firebase config already in `src/firebase.js`

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start Dev Server
```bash
npm run dev
```

Output will show:
```
  VITE v5.2.0  ready in 123 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

### Step 3: Test Flow in Browser

#### Test 1: Create Admin User
1. Open `http://localhost:5173`
2. Register with:
   - Email: `admin@test.com`
   - Password: `admin123`
3. Go to **Firebase Console → Firestore → users**
4. Find your user doc
5. Edit: change `role` from `"student"` to `"admin"`
6. Go back to app, refresh → Admin Dashboard appears ✅

#### Test 2: Add a Route (Admin)
1. In Admin Dashboard, click **Routes** tab
2. Click **+ Add Custom Route**
3. Fill in:
   - Name: `Test Route 1`
   - Label: `North Gate Loop`
   - Description: `Test route for verification`
4. Click **Save**
5. Verify in **Firebase Console → Firestore → routes** collection ✅

#### Test 3: Create Driver User & Test GPS
1. Open **new incognito window** (to stay logged out)
2. Register with:
   - Email: `driver@test.com`
   - Password: `driver123`
3. Go to **Firebase Console → users**, change role to `"driver"`
4. Go back to new window, refresh → **Driver Dashboard** appears ✅
5. Select the route you created
6. Click **▶ Start Trip**
   - ✅ Timer starts
   - ✅ Status shows "Live"
   - ✅ Map should show location (may be default 12.9716, 77.5946 if geo disabled)

#### Test 4: Verify GPS Broadcasting to RTDB
1. While trip is running, go to **Firebase Console → Realtime Database**
2. Look for: `routes/{Test Route 1}/live`
3. You should see live data:
   ```json
   {
     "active": true,
     "driverUid": "...",
     "heading": 0,
     "lat": 12.9716,
     "lng": 77.5946,
     "routeId": "...",
     "speed": 0,
     "updatedAt": 1710000000000
   }
   ```
   ✅ This confirms GPS is broadcasting!

#### Test 5: Verify Trip History
1. Click **■ End Trip** button
2. Wait 2 seconds
3. Click **📋 Trips** tab
4. You should see the completed trip with:
   - Route name
   - Start time
   - End time
   - Duration ✅

---

## ✅ Success Criteria

All three bugs are fixed when:

### Bug #1: Trip History Not Working ✅
- [ ] Driver Dashboard loads without errors
- [ ] **Trips** tab displays past/completed trips
- [ ] Trip data shows: route name, start time, end time, duration

### Bug #2: Location Not Broadcasting ✅
- [ ] When driver starts trip, Firebase Realtime DB updates every 3 seconds
- [ ] `routes/{routeId}/live` contains current lat/lng/speed
- [ ] Can be verified in Firebase Console → Realtime Database

### Bug #3: Student Dashboard Shows No Routes ✅
- [ ] Admin adds routes via Admin Dashboard
- [ ] Student Dashboard displays routes
- [ ] Student can track live bus location

---

## 🔐 Firebase Configuration Summary

### Project ID
`project-8ef56e2a-0de7-492f-b49`

### Services Enabled
- ✅ Authentication (Email/Password)
- ✅ Firestore Database
- ✅ Realtime Database

### Firestore Collections
```
users/{uid}
  - name: string
  - email: string
  - role: "student" | "driver" | "admin"
  - campusId: string

routes/{routeId}
  - name: string
  - label: string
  - campusId: string
  - path: [] (coordinates)
  - stops: []
  - createdAt: timestamp

trips/{tripId}
  - driverUid: string
  - routeId: string
  - routeName: string
  - campusId: string
  - startTime: timestamp
  - endTime: timestamp
  - status: "active" | "completed"
```

### Realtime Database Paths
```
routes/{routeId}/live
  - lat: number
  - lng: number
  - speed: number (km/h)
  - heading: number (degrees)
  - active: boolean
  - updatedAt: timestamp
  - driverUid: string
```

---

## 🆘 Troubleshooting

### Issue: Trips Tab Shows "No trips yet"
**Possible Causes:**
1. Firestore Realtime DB rules not set (RTDB writes fail silently)
2. No trips created yet in the session
3. Wrong `driverUid` filter

**Fix:**
- Verify RTDB rules are published (see Phase 1)
- Create a new trip by clicking "▶ Start Trip"
- Check browser console for errors: Press `F12` → Console tab

### Issue: GPS Location Not Updating
**Possible Causes:**
1. Browser geolocation permission denied
2. Geolocation not available in browser (usually works on localhost)
3. RTDB rules blocking writes

**Fix:**
- Check browser URL bar for location permission prompt
- Allow location access when prompted
- Verify RTDB rules (Phase 1)

### Issue: "No routes available"
**Cause:** Routes collection is empty

**Fix:**
- Go to Admin Dashboard
- Add at least one route
- Refresh Driver Dashboard

---

## 📱 Android Build (Optional)

After verifying on web:

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Then build & run in Android Studio. On Android, GPS will actually work with device location.

---

## ✨ All Set!

Your CampusMove app is now ready to track buses in real-time!
