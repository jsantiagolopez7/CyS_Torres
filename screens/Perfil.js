import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import React, { createContext, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  Image,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Toast from "react-native-toast-message";
import { auth, checkConnectivity, db } from "../database/firebase";

export const UserContext = createContext();

const Perfil = () => {
  const [role, setRole] = useState(null);
  const [isRoleLoaded, setIsRoleLoaded] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [mantenerSesion, setMantenerSesion] = useState(false);
  const [userData, setUserData] = useState({ firstName: "", lastName: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [mounted, setMounted] = useState(true);
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const userId = auth.currentUser?.uid;

  useEffect(() => {
    let isMounted = true;
    let errorRetryCount = 0;
    let timeout;

    const fetchUserData = async () => {
      try {
        // 1. Verificar autenticación con reintentos
        if (!auth.currentUser && errorRetryCount < 3) {
          timeout = setTimeout(() => {
            if (isMounted) {
              errorRetryCount++;
              console.log(
                `Reintento #${errorRetryCount} de obtener usuario autenticado`
              );
              fetchUserData();
            }
          }, 1000);
          return;
        }

        // 2. Iniciar carga y verificar userId
        setLoading(true);
        const userId = auth.currentUser?.uid;
        if (!userId) {
          console.log("⚠️ No hay usuario autenticado para cargar perfil");
          setError("Usuario no autenticado");
          setLoading(false);
          return;
        }

        // 3. Verificar conectividad primero
        const isConnected = await checkConnectivity();
        console.log(
          `📡 Estado de conexión: ${isConnected ? "conectado" : "desconectado"}`
        );

        // 4. MEJORA CRÍTICA: Obtener datos con timeout para evitar bloqueos
        console.log("🔄 Obteniendo datos de usuario desde Firestore...");
        const userDocPromise = getDoc(doc(db, "users", userId));

        // Usar Promise.race para establecer un timeout
        let userDoc;
        try {
          userDoc = await Promise.race([
            userDocPromise,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Timeout obteniendo datos de usuario")),
                8000
              )
            ),
          ]);
        } catch (timeoutError) {
          console.warn(
            "⚠️ Timeout al obtener datos de usuario, verificando si hay datos existentes"
          );
          // Si hay un timeout, intentar obtener los datos sin el race
          userDoc = await userDocPromise.catch((e) => null);
        }

        // 5. Si el documento no existe, créalo para evitar errores futuros
        if (!userDoc?.exists() && isMounted) {
          console.log(
            "⚠️ Documento de usuario no encontrado, creando uno nuevo"
          );

          try {
            // Crear un documento básico de usuario
            await setDoc(doc(db, "users", userId), {
              uid: userId,
              firstName: "Usuario",
              lastName: "Nuevo",
              role: "user",
              createdAt: new Date().toISOString(),
            });

            console.log("✅ Documento de usuario creado correctamente");

            // Obtener el documento recién creado
            userDoc = await getDoc(doc(db, "users", userId));
          } catch (createError) {
            console.error(
              "❌ Error al crear documento de usuario:",
              createError
            );
          }
        }

        // 6. Procesar datos cuando disponibles
        if (userDoc?.exists() && isMounted) {
          console.log("✅ Datos de usuario obtenidos correctamente");
          const data = userDoc.data();

          setRole(data.role || "user");
          setUserData({
            firstName: data.firstName || "Usuario",
            lastName: data.lastName || "Nuevo",
          });
          setProfileImage(data.profileImage || null);
        } else if (isMounted) {
          // 7. Si todavía no hay documento, usar valores predeterminados
          console.log(
            "⚠️ El documento de usuario no existe o no se pudo crear, usando valores por defecto"
          );
          setRole("user");
          setUserData({
            firstName: "Usuario",
            lastName: "Nuevo",
          });
        }
      } catch (err) {
        // 8. Manejo mejorado de errores
        console.error("❌ Error obteniendo datos:", err);

        if (isMounted) {
          setError(
            `Error al cargar datos del usuario: ${err.message || "Desconocido"}`
          );

          // 9. Reintentar con backoff exponencial
          if (errorRetryCount < 5) {
            const retryDelay = Math.min(
              1000 * Math.pow(2, errorRetryCount),
              30000
            );
            console.log(`🔄 Reintentando en ${retryDelay / 1000} segundos...`);

            timeout = setTimeout(() => {
              if (isMounted) {
                errorRetryCount++;
                fetchUserData();
              }
            }, retryDelay);
          } else {
            console.log("❌ Número máximo de reintentos alcanzado");
          }
        }
      } finally {
        if (isMounted) {
          setIsRoleLoaded(true);
          setLoading(false);
        }
      }
    };

    // Ejecutar inmediatamente
    fetchUserData();

    // Limpieza de recursos al desmontar
    return () => {
      console.log("🧹 Limpiando recursos en Perfil.js");
      isMounted = false;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [userId, isFocused, retryCount]);

  const handleRetry = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  const pickImage = async () => {
    try {
      setLoading(true);

      // 1. Iniciar la selección de imágenes
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7, // Calidad mejorada para mejor visualización
      });

      if (!result.canceled && result.assets && result.assets[0]?.uri) {
        const imageUri = result.assets[0].uri;
        console.log(`🖼 Imagen seleccionada: ${imageUri.substring(0, 50)}...`);

        // 2. Obtener el blob con validación robusta
        const response = await fetch(imageUri);

        // Verificar si la respuesta es válida
        if (!response.ok) {
          throw new Error(
            `Error HTTP: ${response.status} - ${response.statusText}`
          );
        }

        const blob = await response.blob();

        // 3. Verificar que el blob sea válido
        if (!blob || blob.size === 0) {
          throw new Error("Imagen inválida o dañada (tamaño 0)");
        }

        console.log(
          `📊 Preparando subida - Tamaño: ${(blob.size / 1024).toFixed(2)} KB`
        );

        // 4. Obtener referencias a Firebase
        const storage = getStorage();
        const imageName = `profile_${userId}_${Date.now()}`;
        const imageRef = ref(storage, `profileImages/${userId}/${imageName}`);

        // 5. Usar uploadBytesResumable para mejor control y feedback
        console.log("📋 Iniciando subida a Firebase Storage...");
        const uploadTask = uploadBytesResumable(imageRef, blob, {
          contentType: blob.type || "image/jpeg",
        });

        // Manejar la subida con supervisión de progreso
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            // Opcional: reportar progreso
            const progress =
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log(`Subida: ${progress.toFixed(1)}%`);
          },
          (error) => {
            console.error("❌ Error en subida:", error);
            Toast.show({
              type: "error",
              text1: "Error al subir imagen",
              text2: "No se pudo subir la imagen. Inténtelo nuevamente.",
              position: "bottom",
            });
            setLoading(false);
          },
          async () => {
            try {
              // 6. Obtener URL mediante getDownloadURL
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              console.log(
                "🔓 URL obtenida:",
                downloadURL.substring(0, 50) + "..."
              );

              // 7. Actualizar Firestore
              await updateDoc(doc(db, "users", userId), {
                profileImage: downloadURL,
                profileImageUpdatedAt: new Date().toISOString(),
              });

              console.log("✅ Documento de usuario actualizado en Firestore");

              // 8. Actualizar UI
              setProfileImage(downloadURL);

              Toast.show({
                type: "success",
                text1: "Imagen actualizada correctamente",
                position: "bottom",
              });
            } catch (finalError) {
              console.error("❌ Error final:", finalError);
              Toast.show({
                type: "error",
                text1: "Error al actualizar perfil",
                text2: finalError.message,
                position: "bottom",
              });
            } finally {
              setLoading(false);
            }
          }
        );
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error("❌ Error detallado:", error);

      // 9. Mostrar mensajes de error específicos al usuario
      let errorMessage = "No se pudo subir la imagen.";

      if (error.message.includes("HTTP")) {
        errorMessage = "Error de conexión. Compruebe su internet.";
      } else if (error.message.includes("Timeout")) {
        errorMessage =
          "La subida tardó demasiado. Inténtelo con una imagen más pequeña.";
      } else if (error.code === "storage/unauthorized") {
        errorMessage = "No tiene permisos para subir imágenes.";
      }

      Toast.show({
        type: "error",
        text1: "Error al subir imagen",
        text2: errorMessage,
        position: "bottom",
        duration: 4000,
      });
      setLoading(false);
    }
  };

  const deleteProfileImage = async () => {
    try {
      setLoading(true);
      const storage = getStorage();

      // Mejorado: verificar si hay una imagen para eliminar
      if (!profileImage) {
        Toast.show({
          type: "error",
          text1: "No hay imagen para eliminar",
          position: "bottom",
        });
        setLoading(false);
        return;
      }

      // CORREGIDO: Usar la ruta completa extraída de la URL
      try {
        // Intentar extraer la ruta de la URL de Storage
        const url = new URL(profileImage);
        const pathFromUrl = decodeURIComponent(
          url.pathname.split("/o/")[1]?.split("?")[0]
        );

        if (pathFromUrl) {
          const imageRef = ref(storage, pathFromUrl);
          await deleteObject(imageRef);
        } else {
          throw new Error("No se pudo determinar la ruta de la imagen");
        }
      } catch (parseError) {
        console.error("Error al procesar URL:", parseError);
        // Fallback al método original si falla el parsing
        const imageRef = ref(storage, `profileImages/${userId}`);
        await deleteObject(imageRef);
      }

      // Actualizar documento en Firestore
      await updateDoc(doc(db, "users", userId), {
        profileImage: null,
      });

      setProfileImage(null);
      Toast.show({
        type: "success",
        text1: "Imagen eliminada",
        position: "bottom",
      });
    } catch (error) {
      console.error("Error al eliminar imagen:", error);
      Toast.show({
        type: "error",
        text1: "Error al eliminar imagen",
        text2: error.message,
        position: "bottom",
      });
    } finally {
      setLoading(false);
    }
  };

  const cerrarSesion = async () => {
    try {
      if (auth && typeof auth.signOut === "function") {
        await auth.signOut();
        await AsyncStorage.multiRemove(["userSession", "userRole"]);
        navigation.replace("Login");
      } else {
        console.error("Auth no inicializado correctamente");
        await AsyncStorage.multiRemove(["userSession", "userRole"]);
        navigation.replace("Login");
      }
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      Toast.show({
        type: "error",
        text1: "Error al cerrar sesión",
        text2: "No se pudo cerrar la sesión correctamente",
        position: "bottom",
      });
    }
  };

  const ErrorView = ({ message, onRetry }) => (
    <View style={styles.centerContainer}>
      <Text style={styles.errorText}>{message}</Text>
      <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.buttonText}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  );

  const ProfileImageWithFallback = ({ imageUrl, size = 150 }) => (
    <View style={styles.imageContainer}>
      <Image
        source={
          imageUrl ? { uri: imageUrl } : require("../assets/default-avatar.png")
        }
        style={[styles.profileImage, { width: size, height: size }]}
        resizeMode="cover"
        defaultSource={require("../assets/default-avatar.png")} // Fallback adicional
        onError={(e) => {
          console.error(
            "Error cargando imagen de perfil:",
            e.nativeEvent.error
          );
        }}
      />
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      )}
    </View>
  );

  if (loading && !profileImage) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Cargando perfil...</Text>
      </View>
    );
  }

  if (error) {
    return <ErrorView message={error} onRetry={handleRetry} />;
  }

  return (
    <UserContext.Provider
      value={{
        userData,
        profileImage,
        pickImage,
        deleteProfileImage,
        cerrarSesion,
        mantenerSesion,
        setMantenerSesion,
        loading,
        setLoading,
      }}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Perfil</Text>
        <ProfileImageWithFallback imageUrl={profileImage} />
        <Text style={styles.info}>Nombres: {userData.firstName}</Text>
        <Text style={styles.info}>Apellidos: {userData.lastName}</Text>

        <View style={styles.bottomTabContainer}>
          <Button title="Seleccionar Foto" onPress={pickImage} />
          {profileImage && (
            <TouchableOpacity
              onPress={deleteProfileImage}
              style={[styles.bottomTabButton, { backgroundColor: "#f44336" }]}
            >
              <Text style={styles.bottomTabText}>Borrar Foto</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.switchContainer}>
          <Text>Mantener sesión iniciada</Text>
          <Switch
            value={mantenerSesion}
            onValueChange={setMantenerSesion}
            trackColor={{ false: "#767577", true: "#81b0ff" }}
            thumbColor={mantenerSesion ? "#f5dd4b" : "#f4f3f4"}
          />
        </View>
        {!mantenerSesion && (
          <TouchableOpacity
            onPress={cerrarSesion}
            style={[styles.buttonExit, { marginTop: 20 }]}
          >
            <Text style={styles.buttonText}>Cerrar Sesión</Text>
          </TouchableOpacity>
        )}
      </View>
      <Toast />
    </UserContext.Provider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    marginBottom: 20,
    color: "black",
  },
  profileImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
    marginBottom: 20,
    backgroundColor: "#e0e0e0",
  },
  info: {
    fontSize: 16,
    color: "black",
    marginBottom: 10,
  },
  buttonExit: {
    backgroundColor: "#f44336",
    padding: 10,
    borderRadius: 5,
    width: "60%",
    alignItems: "center",
    marginVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  bottomTabContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: "#ffffff99",
    width: "100%",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    position: "absolute",
    bottom: 0,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  bottomTabButton: {
    backgroundColor: "#4CAF50",
    padding: 10,
    borderRadius: 5,
    width: "40%",
    alignItems: "center",
  },
  bottomTabText: {
    color: "white",
    fontWeight: "bold",
  },
  switchContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "80%",
    marginTop: 20,
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
  },
  imageContainer: {
    position: "relative",
    marginBottom: 20,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 75,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#f5f5f5",
  },
  errorText: {
    fontSize: 16,
    color: "#e74c3c",
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 6,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
});

export default Perfil;
