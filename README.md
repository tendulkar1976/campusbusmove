# CampusMove — React + Firebase + Capacitor

Live campus bus tracking app. 3 roles: Student, Driver, Admin. Multi-campus ready.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Add Firebase config
Edit `src/firebase.js` — replace all `YOUR_*` values with your Firebase project keys.

Firebase services needed:
- Authentication (Email/Password)
- Firestore Database
- Realtime Database

### 3. Run locally
```bash
npm run dev
```

### 4. Build for Android
```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Then in Android Studio: Run → select device or emulator.

### 5. Add GPS permissions
In `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
```

## Firebase Firestore structure

### users/{uid}
```json
{ "name": "K Tendulkar", "email": "...", "role": "student", "campusId": "alliance-bangalore" }
```

### routes/{routeId}
```json
{ "name": "Route 1", "label": "North Gate Loop", "campusId": "alliance-bangalore", "path": [], "stops": [] }
```

### Realtime DB: routes/{routeId}/live
```json
{ "lat": 12.9716, "lng": 77.5946, "active": true, "updatedAt": 1710000000000 }
```

## Create first admin
Register normally → go to Firebase Console → Firestore → users → find your doc → change role to "admin".
