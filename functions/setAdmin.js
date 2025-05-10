const admin = require("firebase-admin");

// Cargar las credenciales del servicio desde la carpeta database
const serviceAccount = require("../database/serviceAccountKey.json");

// Inicializar Firebase Admin (evita inicializarlo dos veces si ya está en otro archivo)
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Función para asignar el rol de administrador
async function setAdminRole(uid) {
  try {
    await admin.auth().setCustomUserClaims(uid, { role: "admin" });

    console.log(`✅ El usuario con UID ${uid} ahora es administrador.`);
  } catch (error) {
    console.error("❌ Error al asignar el rol de admin:", error.message);
  }
}

// Especifica el UID del usuario administrador
const adminUID = "mYAMKNUaBeSBKCWT4T1syfi8VLS2"; // UID del usuario registrado
setAdminRole(adminUID);
