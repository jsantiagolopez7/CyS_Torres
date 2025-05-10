/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const {onRequest} = require("firebase-functions/v2/https");
// const logger = require("firebase-functions/logger");

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.addAdminRole = functions.https.onCall(async (data, context) => {
  // Verificación de autenticación
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes estar autenticado para realizar esta acción."
    );
  }

  // Validar entrada
  if (!data.email) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Se requiere un correo electrónico."
    );
  }

  try {
    // Obtener usuario objetivo
    const user = await admin.auth().getUserByEmail(data.email);

    // Verificar si ya es admin
    if (user.customClaims?.role === "admin") {
      return { message: `${data.email} ya es administrador.` };
    }

    // Verificar permisos del solicitante (Admin SDK ignora reglas de Firestore)
    const requestingUser = await admin.auth().getUser(context.auth.uid);
    if (requestingUser.customClaims?.role !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Solo administradores pueden realizar esta acción."
      );
    }

    // Actualizar Claims y Firestore
    await admin.auth().setCustomUserClaims(user.uid, { role: "admin" });
    await db.collection("admins").doc(user.uid).set({
      assignedBy: context.auth.uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Actualizar documento en 'users' (opcional)
    await db
      .collection("users")
      .doc(user.uid)
      .set({ role: "admin" }, { merge: true });

    return { message: `✅ ${data.email} ahora es administrador.` };
  } catch (error) {
    console.error("Error detallado:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Error al procesar la solicitud."
    );
  }
});

// 🔥 NUEVA FUNCIÓN PARA NOTIFICACIONES DE CIERRE DE JORNADA
exports.notificarCierreJornadaAdmin = functions.firestore
  .document("jornadas/{jornadaId}")
  .onCreate(async (snapshot, context) => {
    try {
      // 1. Obtener datos de la jornada cerrada
      const jornadaData = snapshot.data();
      
      // Verificar datos mínimos necesarios
      if (!jornadaData || !jornadaData.userId || !jornadaData.fecha) {
        console.error("❌ Datos de jornada incompletos:", jornadaData);
        return false;
      }
      
      // 2. Obtener información del usuario que cerró la jornada
      let nombreUsuario = "Usuario";
      try {
        const userDoc = await admin.firestore().collection("users").doc(jornadaData.userId).get();
        if (userDoc.exists) {
          nombreUsuario = `${userDoc.data().firstName || ''} ${userDoc.data().lastName || ''}`;
        }
      } catch (userError) {
        console.warn("⚠️ No se pudo obtener nombre de usuario:", userError);
      }
      
      // 3. Buscar todos los administradores
      const adminsSnapshot = await admin.firestore().collection("users")
        .where("role", "==", "admin")
        .get();

      // 4. Recoger tokens FCM válidos
      const tokens = [];
      adminsSnapshot.forEach((doc) => {
        const token = doc.data().fcmToken;
        if (token) tokens.push(token);
      });

      console.log(`📱 Encontrados ${tokens.length} dispositivos de administradores para notificar`);
      
      if (tokens.length === 0) {
        console.log("⚠️ No hay tokens FCM de administradores disponibles");
        return true; 
      }

      // 5. Calcular horas totales trabajadas en todas las plantas
      let horasTotales = 0;
      let minutosTotales = 0;
      
      if (jornadaData.plantas) {
        Object.values(jornadaData.plantas).forEach(plantaSessions => {
          if (Array.isArray(plantaSessions)) {
            plantaSessions.forEach(session => {
              if (session.entry && session.exit) {
                try {
                  const entryDate = new Date(session.entry);
                  const exitDate = new Date(session.exit);
                  const diffMs = exitDate - entryDate;
                  
                  horasTotales += Math.floor(diffMs / (1000 * 60 * 60));
                  minutosTotales += Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                } catch (error) {
                  console.warn("Error calculando horas:", error);
                }
              }
            });
          }
        });
      }
      
      // Convertir minutos extras a horas
      horasTotales += Math.floor(minutosTotales / 60);
      minutosTotales = minutosTotales % 60;
      
      // 6. Crear payload de notificación mejorado
      const payload = {
        notification: {
          title: `🔒 ${nombreUsuario} cerró jornada`,
          body: `Fecha: ${jornadaData.fecha} - Total: ${horasTotales}h ${minutosTotales}m`,
          sound: "default",
          android_channel_id: "cierre_jornadas"
        },
        data: {
          tipo: "cierre_jornada",
          userId: jornadaData.userId,
          jornadaId: context.params.jornadaId,
          fecha: jornadaData.fecha,
          userName: nombreUsuario,
          click_action: "ABRIR_REGISTROS_USUARIOS"
        }
      };

      // 7. Enviar notificaciones
      const response = await admin.messaging().sendToDevice(tokens, payload);
      
      console.log(`📨 Notificación de cierre enviada a ${tokens.length} administradores`);
      console.log(`✅ Resultados: ${response.successCount} éxitos, ${response.failureCount} fallos`);
      
      // 8. Actualizar el documento con información de la notificación enviada
      await snapshot.ref.update({
        notificationSent: true,
        notificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
        notificationRecipients: tokens.length,
        notificationSuccess: response.successCount,
        notificationFailure: response.failureCount
      });
      
      return true;
    } catch (error) {
      console.error("❌ Error en notificación de cierre:", error);
      return false;
    }
  });
