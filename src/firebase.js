import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);