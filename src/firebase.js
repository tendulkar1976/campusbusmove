import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBrwoWVjeHoJA_GG2ii7UPlVIMulP1yciA",
  authDomain: "project-8ef56e2a-0de7-492f-b49.firebaseapp.com",
  databaseURL: "https://project-8ef56e2a-0de7-492f-b49-default-rtdb.firebaseio.com",
  projectId: "project-8ef56e2a-0de7-492f-b49",
  storageBucket: "project-8ef56e2a-0de7-492f-b49.firebasestorage.app",
  messagingSenderId: "2733288149",
  appId: "1:2733288149:web:023f31b865312bace0505c"
};

const app = initializeApp(firebaseConfig);
const secondaryApp = initializeApp(firebaseConfig, "secondary");

export const auth = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);

// Enable persistent local IndexedDB cache for instant data loads
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const rtdb = getDatabase(app);

import { collection, addDoc } from "firebase/firestore";
export async function logActivity(action, details, campusId = "global") {
  try {
    await addDoc(collection(db, "logs"), {
      campusId,
      action,
      details,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error("Activity logging failed:", err);
  }
}