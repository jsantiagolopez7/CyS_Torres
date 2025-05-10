import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCcO0nN_oevW1z8DpQRYd68_micx_3IhzA",
  authDomain: "cys-torres-sas.firebaseapp.com",
  projectId: "cys-torres-sas",
  storageBucket: "cys-torres-sas.appspot.com",
  messagingSenderId: "940005830280",
  appId: "1:940005830280:android:3b82c186d161162822793d",
};

// Inicializar Firebase solo si no está inicializado
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);

// Objeto auth simulado para modo híbrido
export const auth = {
  onAuthStateChanged: (callback) => {
    AsyncStorage.getItem("userData")
      .then((data) => {
        if (data) {
          const userData = JSON.parse(data);
          callback(userData);
        } else {
          callback(null);
        }
      })
      .catch((error) => {
        console.error("Error retrieving auth state:", error);
        callback(null);
      });

    return () => {};
  },
  currentUser: null,
};

// Inicializar currentUser desde AsyncStorage
AsyncStorage.getItem("userData")
  .then((data) => {
    if (data) {
      auth.currentUser = JSON.parse(data);
    }
  })
  .catch(console.error);

export const completeFirebaseInit = () => {
  console.log("Firebase inicializado correctamente");
  return true;
};
