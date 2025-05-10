import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { Picker } from "@react-native-picker/picker";
import { toZonedTime } from "date-fns-tz";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { collection, doc, getDoc, setDoc } from "firebase/firestore"; // Añadido getDoc para checkFirebaseAccess
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db, migrateStorageUrls, storage } from "../database/firebase";

const ACTION_ENTRY = "entry";
const ACTION_EXIT = "exit";

const RegistroHora = ({ navigation }) => {
  // CORRECTO: Define TODOS los refs al inicio del componente antes de cualquier uso
  const isMountedRef = useRef(true);
  const connectionRef = useRef(null);
  const timeoutsRef = useRef([]);
  const syncInProgressRef = useRef(false); // Reemplaza la variable global syncInProgress
  const lockChangeRef = useRef(false); // Reemplaza la variable global lockChange
  const timeoutRef = useRef(null); // Reemplaza la variable global timeout
  const loadingTimeoutRef = useRef(null); // Para efecto principal
  const saveTimeoutRef = useRef(null); // Para efecto de guardado
  const saveMountedRef = useRef(true); // Para efecto de guardado
  const permissionsMountedRef = useRef(true); // Para efecto de permisos
  const isRegistering = useRef(false); // Para evitar registros duplicados

  // Estados React normales
  const [entryImage, setEntryImage] = useState(null);
  const [exitImage, setExitImage] = useState(null);
  const [sessions, setSessions] = useState({
    "Planta 1": [],
    "Planta 2": [],
  });
  const [selectedPlant, setSelectedPlant] = useState("Planta 1");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [showDelete, setShowDelete] = useState(false); // Estado para mostrar el botón
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Función helper para verificar Firebase
  const checkFirebaseAccess = async () => {
    try {
      await getDoc(doc(db, "_connection_test", "status"));
      return true;
    } catch (error) {
      return false;
    }
  };

  // Efecto para manejo de autenticación
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // 1. Efecto principal para cargar datos al inicio (corregido)
  useEffect(() => {
    const loadAllData = async () => {
      try {
        const firebaseAvailable = await checkFirebaseAccess();
        if (!firebaseAvailable) {
          console.log("📡 Firebase no disponible, usando modo offline");
          return;
        }

        // VALIDACIÓN INICIAL
        const userId = auth.currentUser?.uid;
        if (!userId || !isMountedRef.current) {
          console.log("⚠️ No hay usuario autenticado o componente desmontado");
          return;
        }

        // CORRECCIÓN: Verificar conectividad primero
        const netInfo = await NetInfo.fetch();
        const isConnected =
          netInfo.isConnected && netInfo.isInternetReachable !== false;
        console.log(
          `📡 Estado de conectividad inicial: ${
            isConnected ? "conectado" : "sin conexión"
          }`
        );

        // Ejecutar migración de URLs solamente si hay conexión
        if (isConnected) {
          try {
            console.log("🔄 Ejecutando migración de URLs...");
            await migrateStorageUrls();
          } catch (migrationError) {
            console.error("❌ Error en migración de URLs:", migrationError);
            // Error no bloqueante, continuamos
          }
        }

        if (!isMountedRef.current) return; // Verificar después de cada operación asíncrona

        setLoading(true);
        console.log("🔄 Iniciando carga completa de datos...");

        // 1. CARGA PARALELA EFICIENTE CON TIMEOUT DE SEGURIDAD
        let sessionsData, storedPlant, lastActionStored;
        try {
          // CORRECCIÓN: Cargar datos secuencialmente en lugar de Promise.all para mejor manejo de errores
          sessionsData = await AsyncStorage.getItem(`sessions_${userId}`);
          storedPlant = await AsyncStorage.getItem("selectedPlant");
          lastActionStored = await AsyncStorage.getItem(`lastAction_${userId}`);
        } catch (storageError) {
          console.warn(
            "⚠️ Error cargando datos de AsyncStorage:",
            storageError.message
          );
          // Inicializar con valores predeterminados en caso de error
          sessionsData = null;
          storedPlant = null;
          lastActionStored = null;
        }

        if (!isMountedRef.current) return;

        // 2. VALIDACIÓN ROBUSTA DE PLANTA SELECCIONADA
        const validPlant = ["Planta 1", "Planta 2"].includes(storedPlant)
          ? storedPlant
          : "Planta 1";

        // Actualizar estado inmediatamente para evitar parpadeos en UI
        setSelectedPlant(validPlant);
        console.log(`🌱 Planta seleccionada: ${validPlant}`);

        // 3. PROCESAMIENTO DE SESIONES CON VALIDACIÓN ESTRUCTURADA Y RESPALDO
        let parsedSessions = { "Planta 1": [], "Planta 2": [] };

        if (sessionsData) {
          try {
            // CORRECCIÓN: Validación más robusta del formato JSON
            if (typeof sessionsData !== "string" || !sessionsData.trim()) {
              throw new Error("Datos de sesión vacíos o inválidos");
            }

            if (!sessionsData.trim().startsWith("{")) {
              throw new Error("Formato JSON inválido");
            }

            const parsed = JSON.parse(sessionsData);

            // Validación estructural completa
            if (typeof parsed !== "object" || parsed === null) {
              throw new Error("Estructura de datos inválida");
            }

            // Normalización defensiva de datos
            parsedSessions = {
              "Planta 1": Array.isArray(parsed["Planta 1"])
                ? parsed["Planta 1"]
                : [],
              "Planta 2": Array.isArray(parsed["Planta 2"])
                ? parsed["Planta 2"]
                : [],
            };

            console.log(
              `📊 Sesiones cargadas - Planta 1: ${parsedSessions["Planta 1"].length}, Planta 2: ${parsedSessions["Planta 2"].length}`
            );
          } catch (parseError) {
            console.error("❌ Error parseando sesiones:", parseError.message);

            // Crear respaldo automático antes de reiniciar
            const backupKey = `sessions_backup_${userId}_${Date.now()}`;
            await AsyncStorage.setItem(backupKey, sessionsData || "");
            console.log(
              `⚠️ Datos potencialmente corruptos respaldados en ${backupKey}`
            );

            // No eliminar los datos originales hasta que el respaldo esté confirmado
            try {
              const backupVerification = await AsyncStorage.getItem(backupKey);
              if (backupVerification) {
                await AsyncStorage.removeItem(`sessions_${userId}`);
                console.log(
                  "🔄 Datos originales eliminados después de backup exitoso"
                );
              }
            } catch (backupError) {
              console.error("❌ Error en verificación de backup:", backupError);
            }
          }
        }

        if (!isMountedRef.current) return;

        // Actualizar estado de sesiones de forma atómica
        setSessions(parsedSessions);
        setLastAction(lastActionStored || "");

        // 4. CARGA DE IMÁGENES CON SISTEMA ANTI-BLOQUEO
        // Obtener TODAS las claves primero para búsqueda eficiente
        let allKeys;
        try {
          allKeys = await AsyncStorage.getAllKeys();
        } catch (keysError) {
          console.error(
            "❌ Error al obtener claves de AsyncStorage:",
            keysError
          );
          allKeys = [];
        }

        if (!isMountedRef.current) return;

        try {
          // CORRECCIÓN: Cargar imágenes de la planta actual primero, y de manera secuencial
          console.log(`🔍 Cargando imágenes para ${validPlant}...`);
          await loadPlantImages(userId, validPlant, allKeys, parsedSessions);

          // CORRECCIÓN: Verificar si el componente sigue montado antes de cargar planta secundaria
          if (isMountedRef.current) {
            // Solo cargar imágenes secundarias si hay tiempo y recursos
            const secondaryPlant =
              validPlant === "Planta 1" ? "Planta 2" : "Planta 1";
            console.log(
              `🔍 Pre-cargando datos para ${secondaryPlant} en segundo plano...`
            );
            await loadSecondaryPlantImages(userId, secondaryPlant, allKeys);
          }

          console.log("✅ Carga inicial completada exitosamente");
        } catch (imageLoadError) {
          console.error("❌ Error al cargar imágenes:", imageLoadError);
        }
      } catch (error) {
        console.error("❌ Error general en carga inicial:", error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);

          // CORRECCIÓN: Verificación final simplificada con mejor manejo de errores
          loadingTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              try {
                checkEntryImage();
              } catch (verificationError) {
                console.error(
                  "❌ Error en verificación final:",
                  verificationError
                );

                // CORRECCIÓN: Intentar una verificación más simple como último recurso
                try {
                  const plant = selectedPlant || "Planta 1";
                  console.log(
                    `🔍 Ejecutando verificación de respaldo para ${plant}`
                  );

                  // Simplemente asegurar que tenemos imágenes de entrada/salida actualizadas
                  if (!entryImage) {
                    console.log(
                      "⚠️ Sin imagen de entrada, verificando disponibles"
                    );
                    // Código simplificado para buscar imágenes disponibles
                  }
                } catch (fallbackError) {
                  console.log("⚠️ Error incluso en verificación de respaldo");
                }
              }
            }
          }, 1000); // CORRECCIÓN: Tiempo reducido para mejor experiencia
        }
      }
    };

    // Función específica para cargar imágenes de la planta seleccionada (prioritaria)
    const loadPlantImages = async (userId, plant, allKeys, sessions) => {
      if (!isMountedRef.current) return; // CORRECCIÓN: Verificar montaje

      try {
        console.log(`🔍 Cargando imágenes para ${plant}...`);

        // ENTRADA: Buscar todas las claves de imágenes de entrada para esta planta con validación
        const entryKeys = Array.isArray(allKeys)
          ? allKeys.filter((key) =>
              key.startsWith(`entryImage_${userId}_${plant}_`)
            )
          : [];

        if (entryKeys.length > 0) {
          console.log(
            `🔎 Encontradas ${entryKeys.length} imágenes de entrada para ${plant}`
          );

          // Ordenar por fecha (más reciente primero), con validación
          try {
            entryKeys.sort((a, b) => {
              // CORRECCIÓN: Manejo más robusto de fechas
              try {
                // Extraer fechas de manera segura
                const dateA = a.split("_").pop() || "";
                const dateB = b.split("_").pop() || "";
                return dateB.localeCompare(dateA);
              } catch (sortError) {
                return 0; // En caso de error, no cambiar orden
              }
            });
          } catch (sortError) {
            console.error("❌ Error ordenando claves de imágenes:", sortError);
          }

          const latestEntryKey = entryKeys[0];
          console.log(`✅ Usando clave más reciente: ${latestEntryKey}`);

          // Cargar datos de la imagen más reciente con manejo de errores mejorado
          try {
            const entryDataJson = await AsyncStorage.getItem(latestEntryKey);

            if (!entryDataJson) {
              console.warn(`⚠️ Datos vacíos para ${latestEntryKey}`);
              return;
            }

            if (!isMountedRef.current) return;

            let entryData;
            try {
              entryData = JSON.parse(entryDataJson);
            } catch (parseError) {
              console.error(
                `❌ Error al parsear datos de ${latestEntryKey}:`,
                parseError
              );
              return;
            }

            if (entryData?.imageUrl) {
              // CORRECCIÓN CRÍTICA: Corrección de dominio para URLs de Firebase Storage
              let imageUrl = entryData.imageUrl;
              let urlFix = false;

              // Corregir URL de Firebase Storage que usan dominio incorrecto
              if (typeof imageUrl === "string" && imageUrl.startsWith("http")) {
                if (imageUrl.includes("cys-torres-sas.firebasestorage.app")) {
                  imageUrl = imageUrl.replace(
                    "cys-torres-sas.firebasestorage.app",
                    "cys-torres-sas.appspot.com"
                  );
                  urlFix = true;
                  console.log("🔧 Corrigiendo dominio en URL de entrada");
                }
              }

              // CRÍTICO: Solo actualizar la imagen si estamos en la planta correcta
              // y el componente sigue montado
              if (selectedPlant === plant && isMountedRef.current) {
                console.log(
                  `🖼️ Estableciendo imagen de entrada para ${plant}: ${imageUrl.substring(
                    0,
                    40
                  )}...`
                );
                setEntryImage(imageUrl);

                // Guardar URL corregida si fue necesario
                if (urlFix) {
                  entryData.imageUrl = imageUrl;
                  entryData.urlCorrected = true;
                  await AsyncStorage.setItem(
                    latestEntryKey,
                    JSON.stringify(entryData)
                  );
                  console.log("✅ URL corregida guardada en AsyncStorage");
                }
              }

              // OPTIMIZACIÓN: Verificación de consistencia mejorada entre imágenes y sesiones
              const plantSessions = sessions[plant] || [];
              const hasActiveSession = plantSessions.some(
                (s) => s.entry && !s.exit
              );

              // Solo recrear sesión si no hay una activa, estamos en la planta correcta
              // y el componente sigue montado
              if (
                !hasActiveSession &&
                selectedPlant === plant &&
                isMountedRef.current
              ) {
                console.log(
                  `⚠️ Detectada imagen sin sesión activa en ${plant}. Recreando sesión...`
                );

                try {
                  // Crear copia defensiva para evitar mutaciones
                  const sessionsCopy = JSON.parse(JSON.stringify(sessions));
                  const updatedPlantSessions = [...(sessionsCopy[plant] || [])];

                  // NUEVO: Evitar duplicados con verificación mejorada
                  const sessionExists = updatedPlantSessions.some(
                    (session) =>
                      session.entryImage === entryData.imageUrl ||
                      (session.entry &&
                        entryData.timestamp &&
                        Math.abs(
                          new Date(session.entry) -
                            new Date(entryData.timestamp)
                        ) < 60000) // Menos de 1 minuto de diferencia
                  );

                  if (!sessionExists) {
                    // Recrear sesión con datos completos y marcadores de auditoría
                    updatedPlantSessions.push({
                      entry: entryData.timestamp || new Date().toISOString(),
                      entryImage: imageUrl, // Usar la URL corregida
                      entryLocation: entryData.location || null,
                      plant: plant,
                      recreatedAt: new Date().toISOString(),
                      recreatedFrom: "imageCheck",
                      recreationReason: "missingActiveSession",
                      autoRecovery: true,
                    });

                    // Actualizar estructura completa de sesiones
                    sessionsCopy[plant] = updatedPlantSessions;

                    // CRÍTICO: Actualizar el estado y persistencia de manera atómica
                    setSessions(sessionsCopy);

                    // Persistir en AsyncStorage de forma asíncrona
                    await AsyncStorage.setItem(
                      `sessions_${userId}`,
                      JSON.stringify(sessionsCopy)
                    )
                      .then(() =>
                        console.log(`✅ Sesión recreada guardada para ${plant}`)
                      )
                      .catch((err) =>
                        console.error(
                          `❌ Error guardando sesión recreada: ${err.message}`
                        )
                      );
                  } else {
                    console.log(
                      `ℹ️ Sesión similar ya existe para ${plant}, evitando duplicado`
                    );
                  }
                } catch (sessionError) {
                  console.error("❌ Error al recrear sesión:", sessionError);
                }
              }
            }
          } catch (entryError) {
            console.error(
              `❌ Error procesando imagen de entrada para ${plant}:`,
              entryError
            );
          }
        } else {
          console.log(`ℹ️ No hay imágenes de entrada para ${plant}`);

          // Solo limpiar la imagen si estamos en esta planta y el componente sigue montado
          if (selectedPlant === plant && isMountedRef.current) {
            setEntryImage(null);
          }
        }

        // SALIDA: Manejo mejorado para imágenes de salida
        if (isMountedRef.current) {
          // CORRECCIÓN: Usar Date sin dependencias de formato
          const today = new Date().toISOString().split("T")[0];
          const exitKey = `exitImage_${userId}_${plant}_${today}`;

          if (allKeys.includes(exitKey)) {
            try {
              const exitDataJson = await AsyncStorage.getItem(exitKey);

              if (!exitDataJson) {
                console.warn(`⚠️ Datos de salida vacíos para ${exitKey}`);
              } else if (isMountedRef.current && selectedPlant === plant) {
                try {
                  const exitData = JSON.parse(exitDataJson);

                  if (!exitData?.imageUrl) {
                    console.warn(`⚠️ URL de imagen faltante en ${exitKey}`);
                    return;
                  }

                  // CORRECCIÓN: Verificación y corrección de URL para imagen de salida
                  let exitImageUrl = exitData.imageUrl;
                  let exitUrlFix = false;

                  if (
                    typeof exitImageUrl === "string" &&
                    exitImageUrl.startsWith("http")
                  ) {
                    // CORRECCIÓN: Mismo problema de dominio en URLs de salida
                    if (
                      exitImageUrl.includes(
                        "cys-torres-sas.firebasestorage.app"
                      )
                    ) {
                      exitImageUrl = exitImageUrl.replace(
                        "cys-torres-sas.firebasestorage.app",
                        "cys-torres-sas.appspot.com"
                      );
                      exitUrlFix = true;
                      console.log("🔧 Corrigiendo dominio en URL de salida");
                    }
                  }

                  console.log(
                    `🖼️ Estableciendo imagen de salida para ${plant}`
                  );
                  setExitImage(exitImageUrl);

                  // Guardar URL corregida si fue necesario
                  if (exitUrlFix) {
                    exitData.imageUrl = exitImageUrl;
                    exitData.urlCorrected = true;
                    await AsyncStorage.setItem(
                      exitKey,
                      JSON.stringify(exitData)
                    );
                    console.log(
                      "✅ URL de salida corregida guardada en AsyncStorage"
                    );
                  }
                } catch (exitParseError) {
                  console.error(
                    `❌ Error al parsear datos de salida: ${exitParseError.message}`
                  );
                }
              }
            } catch (exitError) {
              console.error(
                `❌ Error procesando imagen de salida para ${plant}:`,
                exitError
              );
            }
          } else {
            // MEJORA: Buscar la imagen de salida más reciente si no hay para hoy
            try {
              const exitKeys = allKeys.filter((key) =>
                key.startsWith(`exitImage_${userId}_${plant}_`)
              );

              if (
                exitKeys.length > 0 &&
                isMountedRef.current &&
                selectedPlant === plant
              ) {
                // Ordenar por fecha (más reciente primero)
                exitKeys.sort((a, b) => {
                  // CORRECCIÓN: Manejo más robusto de fechas
                  try {
                    const dateA = a.split("_").pop() || "";
                    const dateB = b.split("_").pop() || "";
                    return dateB.localeCompare(dateA);
                  } catch (error) {
                    return 0;
                  }
                });

                const latestExitKey = exitKeys[0];
                const exitDataJson = await AsyncStorage.getItem(latestExitKey);

                if (
                  exitDataJson &&
                  selectedPlant === plant &&
                  isMountedRef.current
                ) {
                  try {
                    const exitData = JSON.parse(exitDataJson);
                    if (exitData?.imageUrl) {
                      console.log(
                        `🖼️ Recuperando última imagen de salida para ${plant}`
                      );
                      setExitImage(exitData.imageUrl);
                    }
                  } catch (parseError) {
                    console.error(
                      `❌ Error al parsear datos de salida históricos:`,
                      parseError
                    );
                  }
                }
              }
            } catch (exitHistoryError) {
              console.warn(
                `⚠️ Error cargando historial de salidas: ${exitHistoryError.message}`
              );
            }
          }
        }
      } catch (error) {
        console.error(
          `❌ Error general cargando imágenes para ${plant}:`,
          error
        );
      }
    };

    // Función para precargar imágenes secundarias (simplificada para mejor rendimiento)
    const loadSecondaryPlantImages = async (
      userId,
      secondaryPlant,
      allKeys
    ) => {
      // CORRECCIÓN: Verificar que el componente esté montado
      if (!isMountedRef.current) return;

      try {
        // Solo buscar claves y hacer prefetch básico para mejorar rendimiento posterior
        const entryKeys = allKeys.filter((key) =>
          key.startsWith(`entryImage_${userId}_${secondaryPlant}_`)
        );

        if (entryKeys.length > 0) {
          entryKeys.sort((a, b) => {
            // CORRECCIÓN: Manejo más robusto de fechas
            try {
              const dateA = a.split("_").pop() || "";
              const dateB = b.split("_").pop() || "";
              return dateB.localeCompare(dateA);
            } catch (error) {
              return 0;
            }
          });

          // Solo prefetch, sin procesamiento
          const latestKey = entryKeys[0];
          await AsyncStorage.getItem(latestKey);
          console.log(`✅ Datos para ${secondaryPlant} pre-cargados en caché`);
        }
      } catch (error) {
        // Errores no críticos, solo log
        console.log(
          `ℹ️ Error no crítico pre-cargando ${secondaryPlant}:`,
          error.message
        );
      }
    };

    // Cargar datos solo si hay usuario autenticado
    if (isAuthReady && auth.currentUser) {
      loadAllData().catch((error) => {
        console.error("❌ Error no controlado en carga inicial:", error);
      });
    } else {
      console.log("⚠️ Sin usuario autenticado, esperando autenticación");
    }

    // Limpieza al desmontar el componente
    return () => {
      console.log("🧹 Limpiando recursos del efecto principal");
      isMountedRef.current = false; // Prevenir actualizaciones de estado después de desmontaje

      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [isAuthReady]);

  // 2. Efecto para guardado automático con debounce (corregido)
  useEffect(() => {
    // No declarar useRef aquí - usar los refs definidos al inicio del componente

    const saveAllData = async () => {
      if (!saveMountedRef.current) return;

      const userId = auth.currentUser?.uid;
      if (!userId) {
        console.log("⚠️ No hay usuario autenticado al guardar datos");
        return;
      }

      try {
        console.log("🔄 Iniciando guardado de datos...");

        // 1. Validar datos antes de guardar
        if (!sessions || typeof sessions !== "object") {
          console.warn("⚠️ Datos de sesiones inválidos, abortando guardado");
          return;
        }

        // 2. Usar stringificación con mejor manejo de errores
        let sessionsToSave;
        try {
          sessionsToSave = JSON.stringify(sessions);
        } catch (stringifyError) {
          console.error(
            "❌ Error al convertir sesiones a JSON:",
            stringifyError
          );
          return;
        }

        const plantToSave = selectedPlant || "Planta 1"; // Valor predeterminado para evitar nulos
        const actionToSave = lastAction || "";

        // 3. Guardar datos secuencialmente en lugar de Promise.all para mejor manejo de errores
        await AsyncStorage.setItem(`sessions_${userId}`, sessionsToSave);
        await AsyncStorage.setItem("selectedPlant", plantToSave);
        await AsyncStorage.setItem(`lastAction_${userId}`, actionToSave);

        if (saveMountedRef.current) {
          console.log("✅ Datos guardados automáticamente");
        }
      } catch (error) {
        console.error("❌ Error guardando datos:", error.message);

        // NUEVO: Si el error es específico de una clave, intentar guardar solo esa clave
        if (saveMountedRef.current) {
          try {
            const failedKey = getFailedKeyFromError(error);

            if (failedKey === `sessions_${userId}`) {
              // Si falla sessions, intentar guardar individualmente con try-catch independiente
              try {
                await AsyncStorage.setItem(
                  `sessions_${userId}`,
                  JSON.stringify(sessions)
                );
                console.log(
                  "✅ Datos de sesiones guardados en segundo intento"
                );
              } catch (sessionError) {
                console.error(
                  "❌ Error persistente guardando sesiones:",
                  sessionError.message
                );
              }
            }

            // Guardar planta y última acción siempre, independientemente
            try {
              await AsyncStorage.setItem(
                "selectedPlant",
                selectedPlant || "Planta 1"
              );
              console.log("✅ Planta guardada en segundo intento");
            } catch (plantError) {
              console.error("❌ Error guardando planta:", plantError.message);
            }

            try {
              await AsyncStorage.setItem(
                `lastAction_${userId}`,
                lastAction || ""
              );
              console.log("✅ Última acción guardada en segundo intento");
            } catch (actionError) {
              console.error(
                "❌ Error guardando última acción:",
                actionError.message
              );
            }
          } catch (retryError) {
            console.error("❌ Error en reintento:", retryError.message);
          }
        }
      }
    };

    // Función auxiliar para extraer la clave que falló del mensaje de error
    const getFailedKeyFromError = (error) => {
      if (error && error.message) {
        // Extraer la clave del mensaje de error si es posible
        const match = error.message.match(/key\s+["']([^"']+)["']/i);
        return match ? match[1] : null;
      }
      return null;
    };

    // Implementación mejorada de debounce para evitar guardados excesivos
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (isAuthReady) {
      saveTimeoutRef.current = setTimeout(saveAllData, 500);
    }

    // Cleanup mejorado
    return () => {
      saveMountedRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [sessions, selectedPlant, lastAction, isAuthReady]);

  // 3. Efecto para solicitud de permisos (corregido)
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        // Verificar permisos actuales con mejor manejo de errores
        let cameraPermissionInfo;
        let locationPermissionInfo;

        try {
          cameraPermissionInfo = await ImagePicker.getCameraPermissionsAsync();
          console.log(
            `📷 Estado actual de permisos de cámara: ${cameraPermissionInfo.status}`
          );
        } catch (cameraError) {
          console.warn(
            "⚠️ Error verificando permisos de cámara:",
            cameraError.message
          );
          cameraPermissionInfo = { status: "undetermined", granted: false };
        }

        try {
          locationPermissionInfo =
            await Location.getForegroundPermissionsAsync();
          console.log(
            `📍 Estado actual de permisos de ubicación: ${locationPermissionInfo.status}`
          );
        } catch (locationError) {
          console.warn(
            "⚠️ Error verificando permisos de ubicación:",
            locationError.message
          );
          locationPermissionInfo = { status: "undetermined", granted: false };
        }

        const needsCamera = !cameraPermissionInfo.granted;
        const needsLocation = !locationPermissionInfo.granted;

        // Solo continuar si aún está montado el componente
        if (!permissionsMountedRef.current) return;

        // Si todos los permisos están concedidos, terminamos
        if (!needsCamera && !needsLocation) {
          console.log("✅ Todos los permisos ya están concedidos");
          return;
        }

        // Solicitar permisos uno por uno para mejor manejo de errores
        let cameraGranted = !needsCamera;
        let locationGranted = !needsLocation;

        if (needsCamera) {
          try {
            const cameraResult =
              await ImagePicker.requestCameraPermissionsAsync();
            cameraGranted = cameraResult.status === "granted";
            console.log(
              `📷 Permisos de cámara: ${cameraGranted ? "granted" : "denied"}`
            );
          } catch (cameraError) {
            console.error(
              "❌ Error solicitando permisos de cámara:",
              cameraError.message
            );
          }
        }

        // Verificar montaje entre operaciones async
        if (!permissionsMountedRef.current) return;

        if (needsLocation) {
          try {
            const locationResult =
              await Location.requestForegroundPermissionsAsync();
            locationGranted = locationResult.status === "granted";
            console.log(
              `📍 Permisos de ubicación: ${
                locationGranted ? "granted" : "denied"
              }`
            );
          } catch (locationError) {
            console.error(
              "❌ Error solicitando permisos de ubicación:",
              locationError.message
            );
          }
        }

        // Verificar montaje nuevamente antes de mostrar alerta
        if (!permissionsMountedRef.current) return;

        // Guiar al usuario si los permisos son denegados
        if (!cameraGranted || !locationGranted) {
          const missingPermissions = [];
          if (!cameraGranted) missingPermissions.push("la cámara");
          if (!locationGranted) missingPermissions.push("la ubicación");

          const permissionMessage = missingPermissions.join(" y ");

          Alert.alert(
            "Permisos necesarios",
            `Para usar todas las funciones, necesitamos acceso a ${permissionMessage}.`,
            [
              { text: "Más tarde" },
              {
                text: "Configuración",
                onPress: () => {
                  try {
                    Linking.openSettings();
                  } catch (linkError) {
                    console.error(
                      "❌ Error abriendo configuración:",
                      linkError
                    );
                    // Fallback por si openSettings() falla
                    Alert.alert(
                      "Información",
                      "Por favor, habilita los permisos manualmente en la configuración de la app."
                    );
                  }
                },
              },
            ]
          );
        }
      } catch (error) {
        console.error("❌ Error general solicitando permisos:", error);

        // Mostrar alerta genérica en caso de error no controlado
        if (permissionsMountedRef.current) {
          Alert.alert(
            "Error de permisos",
            "Hubo un problema al verificar los permisos. Algunas funciones pueden no estar disponibles.",
            [{ text: "OK" }]
          );
        }
      }
    };

    // Solicitar permisos al montar el componente
    requestPermissions();

    // Limpieza al desmontar el componente
    return () => {
      permissionsMountedRef.current = false;
    };
  }, []);

  // 4. Efecto para manejo de conexión y sincronización
  useEffect(() => {
    // No definimos isMountedRef aquí - usamos el ref ya declarado al inicio del componente

    const setupConnectionListener = async () => {
      try {
        // 1. Verificar conexión inicial con mejor manejo de errores
        const netInfo = await NetInfo.fetch().catch(() => ({
          isConnected: false,
          isInternetReachable: false,
        }));

        const isConnected =
          netInfo.isConnected && netInfo.isInternetReachable !== false;

        // 2. IMPORTANTE: Intentar sincronización inicial solo si hay conexión y estamos autenticados
        if (
          isConnected &&
          auth.currentUser &&
          !syncInProgressRef.current && // CORREGIDO: Usar .current para acceder al ref
          isMountedRef.current
        ) {
          console.log("📡 Conexión detectada al inicio, sincronizando...");
          syncInProgressRef.current = true; // CORREGIDO: Usar .current para modificar el ref

          try {
            await synchronizeWithFirebase();
            console.log("✅ Sincronización inicial completada");
          } catch (error) {
            console.error(
              "❌ Error en sincronización inicial:",
              error.message || error
            );
          } finally {
            if (isMountedRef.current) {
              syncInProgressRef.current = false; // CORREGIDO: Usar .current
            }
          }
        }

        // 3. MEJORA: Monitoreo de conexión más robusto
        connectionRef.current = NetInfo.addEventListener(async (state) => {
          // Verificar si el componente sigue montado antes de procesar cambios
          if (!isMountedRef.current) return;

          const isOnline =
            state.isConnected && state.isInternetReachable !== false;

          console.log(
            `📡 Cambio de conectividad: ${isOnline ? "Online" : "Offline"}`
          );

          // 4. CORRECCIÓN: Solo sincronizar si estamos online, el usuario está autenticado,
          // y no hay otra sincronización en progreso
          if (
            isOnline &&
            auth.currentUser &&
            !syncInProgressRef.current && // CORREGIDO: Usar .current
            isMountedRef.current
          ) {
            console.log("📡 Conexión detectada, sincronizando...");
            syncInProgressRef.current = true; // CORREGIDO: Usar .current

            try {
              // 5. MEJORA: Usar Promise.race con timeout más inteligente
              const syncResult = await Promise.race([
                synchronizeWithFirebase(),
                new Promise((_, reject) => {
                  const timeoutId = setTimeout(() => {
                    reject(new Error("Timeout en sincronización"));
                  }, 20000); // 20 segundos para timeout

                  // Limpiar timeout si el componente se desmonta
                  return () => clearTimeout(timeoutId);
                }),
              ]);

              // 6. Solo continuar si el componente sigue montado
              if (!isMountedRef.current) return;

              console.log("✅ Sincronización completada");

              // 7. MEJORA: Función de recarga mejorada y con mejor manejo de errores
              try {
                const userId = auth.currentUser?.uid;
                if (userId) {
                  // 8. Cargar datos actualizados después de sincronizar
                  const sessionsData = await AsyncStorage.getItem(
                    `sessions_${userId}`
                  );

                  if (sessionsData && isMountedRef.current) {
                    try {
                      const parsedSessions = JSON.parse(sessionsData);

                      if (
                        parsedSessions &&
                        typeof parsedSessions === "object"
                      ) {
                        setSessions(parsedSessions);
                      }
                    } catch (parseError) {
                      console.error(
                        "❌ Error parseando datos de sesiones:",
                        parseError.message
                      );
                    }
                  }

                  // 9. Verificar imágenes con un pequeño retraso para evitar condiciones de carrera
                  if (isMountedRef.current) {
                    setTimeout(() => {
                      if (isMountedRef.current) {
                        try {
                          checkEntryImage();
                        } catch (checkError) {
                          console.error(
                            "❌ Error en verificación post-sincronización:",
                            checkError.message
                          );
                        }
                      }
                    }, 800);
                  }
                }
              } catch (loadError) {
                console.error(
                  "❌ Error cargando datos actualizados:",
                  loadError.message
                );
              }
            } catch (syncError) {
              // Si el componente ya está desmontado, no hacer nada más
              if (!isMountedRef.current) return;

              console.error(
                "❌ Error en sincronización:",
                syncError.message || syncError
              );

              // 10. MEJORA: Reintentos con backoff exponencial más sofisticado
              let retries = 2;
              let delay = 3000; // 3 segundos inicial
              let retrySuccess = false;

              while (retries > 0 && isMountedRef.current && !retrySuccess) {
                try {
                  console.log(
                    `🔄 Reintento ${3 - retries} de sincronización en ${
                      delay / 1000
                    }s...`
                  );

                  // Esperar con una promesa cancelable
                  await new Promise((resolve) => {
                    const timeoutId = setTimeout(resolve, delay);

                    // Limpiar el timeout si el componente se desmonta durante la espera
                    return () => {
                      if (!isMountedRef.current) clearTimeout(timeoutId);
                    };
                  });

                  // Verificar si el componente sigue montado antes de reintentar
                  if (!isMountedRef.current) break;

                  await synchronizeWithFirebase();
                  console.log("✅ Sincronización exitosa en reintento");
                  retrySuccess = true;
                  break;
                } catch (error) {
                  retries--;
                  delay *= 2; // Backoff exponencial: 3s, 6s

                  // Solo registrar error si el componente sigue montado
                  if (isMountedRef.current) {
                    console.error(
                      `❌ Error en reintento (${retries} restantes):`,
                      error.message || error
                    );
                  }
                }
              }
            } finally {
              // 11. IMPORTANTE: Asegurar que se resetea el flag de sincronización
              if (isMountedRef.current) {
                syncInProgressRef.current = false; // CORREGIDO: Usar .current
              }
            }
          } else if (!isOnline && isMountedRef.current) {
            console.log("📵 Dispositivo sin conexión, usando datos locales");
          }
        });
      } catch (error) {
        console.error(
          "❌ Error configurando listener de conexión:",
          error.message || error
        );
      }
    };

    if (isAuthReady) {
      setupConnectionListener();
    }

    // 12. CORRECCIÓN CRÍTICA: Función de limpieza apropiada
    return () => {
      // Marcar como desmontado inmediatamente
      isMountedRef.current = false;

      // Cancelar la suscripción al listener de conexión
      if (connectionRef.current) {
        connectionRef.current();
        connectionRef.current = null;
      }

      // Registrar la limpieza para depuración
      console.log("🧹 Limpieza de recursos de monitoreo de conexión");
    };
  }, [isAuthReady]);

  // 5. Efecto para cambios en planta seleccionada
  useEffect(() => {
    isMountedRef.current = true;

    const handlePlantChange = async () => {
      if (!selectedPlant || !isMountedRef.current || lockChangeRef.current)
        return;

      lockChangeRef.current = true; // Bloquear para evitar cambios concurrentes

      try {
        console.log(`🌱 Planta seleccionada: ${selectedPlant}`);

        // MEJORA: Limpiar imágenes inmediatamente para evitar mostrar datos incorrectos
        setEntryImage(null);
        setExitImage(null);

        // Guardar preferencia de planta
        await AsyncStorage.setItem("selectedPlant", selectedPlant);

        // MEJORA: Cargar imágenes de la nueva planta de forma directa y optimizada
        const userId = auth.currentUser?.uid;
        if (userId) {
          const allKeys = await AsyncStorage.getAllKeys();

          // Buscar imágenes específicamente para esta planta
          const plantEntryKeys = allKeys.filter((key) =>
            key.startsWith(`entryImage_${userId}_${selectedPlant}_`)
          );

          if (plantEntryKeys.length > 0) {
            // Ordenar y obtener la más reciente
            plantEntryKeys.sort((a, b) => {
              const dateA = a.split("_").pop() || "";
              const dateB = b.split("_").pop() || "";
              return dateB.localeCompare(dateA);
            });

            try {
              if (!isMountedRef.current) return; // Verificación después de operación asíncrona

              const entryDataJson = await AsyncStorage.getItem(
                plantEntryKeys[0]
              );

              if (entryDataJson && isMountedRef.current) {
                const entryData = JSON.parse(entryDataJson);
                if (entryData?.imageUrl) {
                  console.log(
                    `🖼️ Actualizando imagen de entrada para ${selectedPlant}`
                  );

                  // CORRECCIÓN: Verificar y corregir URL antes de usarla
                  let imageUrl = entryData.imageUrl;
                  let urlWasFixed = false;

                  // Corregir URL si contiene dominio incorrecto
                  if (imageUrl.includes("cys-torres-sas.firebasestorage.app")) {
                    imageUrl = imageUrl.replace(
                      "cys-torres-sas.firebasestorage.app",
                      "cys-torres-sas.appspot.com"
                    );
                    urlWasFixed = true;
                    console.log("🔧 Corrigiendo dominio en URL de entrada");
                  }

                  // Si la URL fue corregida, actualizar en AsyncStorage
                  if (urlWasFixed && isMountedRef.current) {
                    entryData.imageUrl = imageUrl;
                    entryData.urlFixed = true;
                    await AsyncStorage.setItem(
                      plantEntryKeys[0],
                      JSON.stringify(entryData)
                    );
                    console.log("✅ URL corregida guardada en AsyncStorage");
                  }

                  if (isMountedRef.current) {
                    setEntryImage(imageUrl);
                  }
                }
              }
            } catch (entryError) {
              console.error("❌ Error cargando imagen de entrada:", entryError);
            }
          }

          // CORRECCIÓN: Verificar si el componente sigue montado antes de continuar
          if (!isMountedRef.current) return;

          // Verificar imágenes después de un breve retardo
          timeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              try {
                checkEntryImage();
              } catch (checkError) {
                console.error(
                  "❌ Error en checkEntryImage durante cambio de planta:",
                  checkError
                );
              }
            }
          }, 500);
        }
      } catch (error) {
        console.error("❌ Error al manejar cambio de planta:", error);

        // MEJORA: Notificar al usuario solo si el componente sigue montado
        if (isMountedRef.current) {
          Alert.alert(
            "Error",
            "No se pudo completar el cambio de planta. Inténtelo nuevamente."
          );
        }
      } finally {
        lockChangeRef.current = false; // Desbloquear sin importar si hubo error
      }
    };

    if (selectedPlant && isAuthReady) {
      handlePlantChange();
    }

    // Limpieza al desmontar el componente
    return () => {
      isMountedRef.current = false; // Marcar como desmontado

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [selectedPlant, isAuthReady]);

  // 6. Efecto para verificación de imágenes al inicio
  useEffect(() => {
    const safeTimeout = (callback, delay) => {
      const id = setTimeout(() => {
        if (isMountedRef.current) callback();
      }, delay);
      timeoutsRef.current.push(id);
      return id;
    };

    const checkImagesOnStartup = async () => {
      if (!auth.currentUser) {
        console.log("⚠️ No hay usuario autenticado para verificar imágenes");
        return;
      }

      const userId = auth.currentUser.uid;
      let verificationAttempts = 0;
      const MAX_ATTEMPTS = 3;

      try {
        // Función para verificar imágenes con reintentos
        const verifyWithRetry = async () => {
          try {
            verificationAttempts++;
            console.log(
              `🔍 Verificación inicial de imágenes (intento ${verificationAttempts})`
            );

            // Verificar que tenemos la planta seleccionada
            if (!selectedPlant && verificationAttempts < MAX_ATTEMPTS) {
              safeTimeout(verifyWithRetry, 1000);
              return;
            }

            const plant = selectedPlant || "Planta 1";

            // 1. CRÍTICO: Obtener todas las claves de una vez para mayor eficiencia
            const allKeys = await AsyncStorage.getAllKeys();

            // 2. Verificar imágenes de entrada
            if (isMountedRef.current) {
              try {
                await checkEntryImage();
              } catch (checkError) {
                console.warn(
                  "⚠️ Error no crítico en verificación:",
                  checkError
                );
              }
            }

            if (!isMountedRef.current) return;

            // 3. Verificar imágenes de salida explícitamente
            const today = getColombianTime().toISOString().split("T")[0];
            const exitKey = `exitImage_${userId}_${plant}_${today}`;

            if (allKeys.includes(exitKey)) {
              try {
                const exitDataJson = await AsyncStorage.getItem(exitKey);

                if (exitDataJson && isMountedRef.current) {
                  const exitData = JSON.parse(exitDataJson);

                  if (exitData?.imageUrl) {
                    // CORRECCIÓN: Verificar y corregir URL de salida
                    let exitImageUrl = exitData.imageUrl;
                    let exitUrlWasFixed = false;

                    // Corregir dominio si es necesario
                    if (
                      exitImageUrl.includes(
                        "cys-torres-sas.firebasestorage.app"
                      )
                    ) {
                      exitImageUrl = exitImageUrl.replace(
                        "cys-torres-sas.firebasestorage.app",
                        "cys-torres-sas.appspot.com"
                      );
                      exitUrlWasFixed = true;
                      console.log("🔧 Corrigiendo URL de salida");
                    } else if (
                      exitImageUrl.includes("cys-torres-sas.appspot.com")
                    ) {
                      // Verificar si la URL funciona
                      try {
                        const response = await fetch(exitImageUrl, {
                          method: "HEAD",
                          timeout: 3000,
                        });
                        if (response.status === 404) {
                          // Si hay error 404, intentar con dominio alternativo
                          const alternativeUrl = exitImageUrl.replace(
                            "cys-torres-sas.appspot.com",
                            "cys-torres-sas.firebasestorage.app"
                          );
                          try {
                            const altResponse = await fetch(alternativeUrl, {
                              method: "HEAD",
                              timeout: 3000,
                            });
                            if (altResponse.ok) {
                              exitImageUrl = alternativeUrl;
                              exitUrlWasFixed = true;
                              console.log(
                                "🔄 URL alternativa de salida funciona"
                              );
                            }
                          } catch (altError) {
                            console.log(
                              "⚠️ Error probando URL alternativa:",
                              altError.message
                            );
                          }
                        }
                      } catch (fetchError) {
                        console.log(
                          "⚠️ Error verificando URL de salida:",
                          fetchError.message
                        );
                      }
                    }

                    // Actualizar AsyncStorage si la URL fue corregida
                    if (exitUrlWasFixed && isMountedRef.current) {
                      exitData.imageUrl = exitImageUrl;
                      exitData.urlFixed = true;
                      exitData.fixedAt = new Date().toISOString();
                      await AsyncStorage.setItem(
                        exitKey,
                        JSON.stringify(exitData)
                      );
                      console.log("✅ URL de salida corregida guardada");
                    }

                    // Actualizar la imagen en el estado
                    if (isMountedRef.current) {
                      console.log("🖼️ Estableciendo imagen de salida del día");
                      setExitImage(exitImageUrl);
                    }
                  }
                }
              } catch (exitError) {
                console.warn(
                  "⚠️ Error verificando imagen de salida:",
                  exitError
                );
              }
            } else {
              // MEJORA: Si no hay imagen de salida para hoy, buscar la más reciente
              const exitKeys = allKeys.filter((key) =>
                key.startsWith(`exitImage_${userId}_${plant}_`)
              );

              if (exitKeys.length > 0 && isMountedRef.current) {
                // Ordenar por fecha para obtener la más reciente
                exitKeys.sort((a, b) => {
                  try {
                    const dateA = a.split("_").pop() || "";
                    const dateB = b.split("_").pop() || "";
                    return dateB.localeCompare(dateA);
                  } catch (error) {
                    return 0;
                  }
                });

                try {
                  const latestExitKey = exitKeys[0];
                  const exitDataJson = await AsyncStorage.getItem(
                    latestExitKey
                  );

                  if (exitDataJson && isMountedRef.current) {
                    const exitData = JSON.parse(exitDataJson);
                    if (exitData?.imageUrl) {
                      console.log(
                        "🖼️ Recuperando última imagen de salida histórica"
                      );
                      setExitImage(exitData.imageUrl);
                    }
                  }
                } catch (exitHistoryError) {
                  console.warn(
                    "⚠️ Error cargando historial de salidas:",
                    exitHistoryError.message
                  );
                }
              }
            }

            console.log("✅ Verificación inicial completada");
          } catch (error) {
            console.error("❌ Error en verificación de imágenes:", error);

            // Reintentar con backoff exponencial
            if (verificationAttempts < MAX_ATTEMPTS && isMountedRef.current) {
              const delay = Math.min(
                1000 * Math.pow(2, verificationAttempts),
                5000
              );
              console.log(
                `🔄 Reintentando verificación en ${delay / 1000}s...`
              );
              safeTimeout(verifyWithRetry, delay);
            } else {
              console.log("⚠️ Se alcanzó el máximo de reintentos");
            }
          }
        };

        // Iniciar con un retraso para dar tiempo a que otros efectos se completen
        safeTimeout(verifyWithRetry, 1200);
      } catch (error) {
        console.error(
          "❌ Error general verificando imágenes al inicio:",
          error
        );
      }
    };

    checkImagesOnStartup();

    // Limpieza al desmontar el componente
    return () => {
      isMountedRef.current = false;
      timeoutsRef.current.forEach((id) => clearTimeout(id));
      timeoutsRef.current = [];
      console.log("🧹 Limpiando recursos de verificación de imágenes");
    };
  }, []);

  const getColombianTime = () => toZonedTime(new Date(), "America/Bogota");

  const verifyImageAccess = async (imageUrl) => {
    if (!imageUrl) return false;

    try {
      // Usar Promise.race con un timeout manual en lugar de AbortSignal.timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 5000);
      });

      const fetchPromise = fetch(imageUrl, { method: "HEAD" });
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      return response.ok;
    } catch (error) {
      console.warn("❌ Error verificando imagen:", error);
      // Si hay error de red, asumir que la imagen es válida
      // Esto es útil cuando la app está offline pero la URL es de Firebase Storage
      return imageUrl.startsWith("https://firebasestorage.googleapis.com");
    }
  };

  const uriToBlob = async (uri) => {
    try {
      const response = await fetch(uri);
      // ▼▼▼ Modificación: Validación de status 200 ▼▼▼
      if (!response.ok || response.status !== 200) {
        throw new Error(
          `❌ Error HTTP ${response.status}: ${response.statusText}`
        );
      }
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

      // ▼▼▼ CORRECCIÓN: Extraer tipo MIME y crear blob correctamente ▼▼▼
      const contentType = response.headers.get("Content-Type") || "image/jpeg";
      const blobData = await response.blob();
      return new Blob([blobData], { type: contentType });
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    } catch (error) {
      throw new Error("❌ Error convirtiendo URI a Blob: " + error.message);
    }
  };

  const uploadFile = async (userId, uri, filename) => {
    if (!auth.currentUser) {
      console.error("🚨 Usuario no autenticado");
      return null;
    }

    if (userId !== auth.currentUser?.uid) {
      console.error("⚠ User ID no coincide con usuario autenticado");
      return null;
    }

    // 1. Crear nombre de archivo único con timestamp para evitar colisiones
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const storagePath = `registros/${userId}/${timestamp}_${randomId}_${filename}`;

    console.log("📂 Intentando subir a:", storagePath);

    try {
      // 2. Crear blob con mejor manejo de errores y tipos
      let blob;
      try {
        console.log("📥 Obteniendo blob desde URI...");
        const response = await fetch(uri);

        if (!response.ok) {
          throw new Error(`Error HTTP: ${response.status}`);
        }

        // Obtener tipo MIME
        const contentType =
          response.headers.get("Content-Type") || "image/jpeg";
        blob = await response.blob();
        console.log(`✅ Blob creado: ${blob.size} bytes, tipo: ${contentType}`);
      } catch (fetchError) {
        console.error(
          "❌ Error al obtener blob con fetch:",
          fetchError.message
        );
        throw fetchError;
      }

      // 3. Validar el blob
      if (!blob || blob.size === 0) {
        throw new Error("Blob inválido o vacío");
      }

      // 4. Crear referencia de Storage y metadata
      const storageRef = ref(storage, storagePath);
      const metadata = {
        contentType: blob.type || "image/jpeg",
        customMetadata: {
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          filename: filename,
        },
      };

      console.log(`📤 Subiendo ${blob.size} bytes a Firebase Storage...`);

      // 5. Subir el archivo con uploadBytes
      const snapshot = await uploadBytes(storageRef, blob, metadata);

      // 6. Obtener URL de descarga usando getDownloadURL (CRÍTICO)
      const downloadURL = await getDownloadURL(snapshot.ref);

      console.log(
        "✅ Archivo subido correctamente:",
        downloadURL.substring(0, 40) + "..."
      );
      return downloadURL;
    } catch (error) {
      console.error("❌ Error en uploadFile:", {
        code: error.code,
        message: error.message,
        name: error.name,
        serverResponse: error.serverResponse,
      });

      // 7. Método de emergencia con URI diferente
      try {
        console.log("🔄 Intentando método de emergencia...");

        const emergencyPath = `registros/${userId}/emergency_${Date.now()}.jpg`;
        const emergencyRef = ref(storage, emergencyPath);

        // Crear blob con método alternativo
        const emergencyResponse = await fetch(uri);
        const emergencyBlob = await emergencyResponse.blob();

        console.log(
          `📤 Método emergencia: subiendo ${emergencyBlob.size} bytes...`
        );

        const emergencySnapshot = await uploadBytes(
          emergencyRef,
          emergencyBlob,
          {
            contentType: "image/jpeg",
          }
        );

        const emergencyURL = await getDownloadURL(emergencySnapshot.ref);

        console.log(
          "✅ Método de emergencia exitoso:",
          emergencyURL.substring(0, 40) + "..."
        );
        return emergencyURL;
      } catch (emergencyError) {
        console.error(
          "❌ Todos los métodos de subida fallaron:",
          emergencyError.message
        );

        // 8. Último recurso: devolver la URI local
        console.log("⚠️ Usando URI local como fallback");
        return uri;
      }
    }
  };

  //  Función para validar si la planta tiene una entrada sin salida
  const validateEntry = (plant) => {
    const plantSessions = sessions[plant] || [];
    const lastSession =
      plantSessions.length > 0 ? plantSessions[plantSessions.length - 1] : null;

    if (lastSession && !lastSession.exit) {
      Alert.alert(
        "Registro bloqueado",
        `Debes registrar salida en ${plant} antes de una nueva entrada.`
      );
      isRegistering.current = false; // Liberar bloqueo
      return false;
    }
    return true;
  };

  const registerAction = async (actionType) => {
    if (isRegistering.current) return;
    isRegistering.current = true;

    try {
      // VALIDACIÓN DE USUARIO
      if (!auth.currentUser) {
        console.error("⚠ No hay usuario autenticado.");
        Alert.alert("Error", "Debes iniciar sesión.");
        isRegistering.current = false;
        return;
      }
      const userId = auth.currentUser.uid;

      // VALIDACIÓN DE PLANTA
      if (!selectedPlant) {
        Alert.alert(
          "Error",
          "Debes seleccionar una planta antes de registrar."
        );
        isRegistering.current = false;
        return;
      }

      // VALIDACIÓN DE ENTRADA
      if (actionType === ACTION_ENTRY && !validateEntry(selectedPlant)) {
        isRegistering.current = false;
        return;
      }

      // VALIDACIÓN DE OTRAS PLANTAS CON ENTRADA ACTIVA
      const plantasConEntradaActiva = Object.entries(sessions).filter(
        ([plant, records]) =>
          plant !== selectedPlant &&
          Array.isArray(records) &&
          records.some((session) => session.entry && !session.exit)
      );

      if (actionType === ACTION_ENTRY && plantasConEntradaActiva.length > 0) {
        Alert.alert(
          "Registro no permitido",
          `Debe registrar salida en ${plantasConEntradaActiva
            .map(([p]) => p)
            .join(", ")} antes de una nueva entrada.`
        );
        isRegistering.current = false;
        return;
      }

      // MANEJO ESPECIAL PARA SALIDA
      if (actionType === ACTION_EXIT) {
        const plantSessions = sessions[selectedPlant] || [];
        const lastSession = plantSessions[plantSessions.length - 1];

        // Si no hay sesión activa pero hay imagen de entrada persistente, recrear sesión
        if (!(lastSession && !lastSession.exit) && entryImage) {
          console.log(
            "✅ Recreando sesión desde imagen de entrada persistente"
          );

          // Obtener metadatos de la imagen desde AsyncStorage
          const allKeys = await AsyncStorage.getAllKeys();
          const entryKeys = allKeys.filter((key) =>
            key.startsWith(`entryImage_${userId}_${selectedPlant}_`)
          );

          if (entryKeys.length > 0) {
            // Ordenar cronológicamente para tomar la más reciente
            entryKeys.sort((a, b) => {
              const dateA = a.split("_").pop();
              const dateB = b.split("_").pop();
              return dateB.localeCompare(dateA); // Más reciente primero
            });

            const latestEntryKey = entryKeys[0];
            const entryDataJson = await AsyncStorage.getItem(latestEntryKey);

            if (entryDataJson) {
              const entryData = JSON.parse(entryDataJson);
              if (entryData?.imageUrl) {
                // Recrear sesión
                const entryTimestamp =
                  entryData.timestamp || new Date().toISOString();

                // Actualizar sesiones inmediatamente para que esté disponible para la salida
                setSessions((prevSessions) => {
                  const updatedSessions = { ...prevSessions };
                  const plantSessions = [
                    ...(updatedSessions[selectedPlant] || []),
                  ];

                  plantSessions.push({
                    entry: entryTimestamp,
                    entryImage: entryData.imageUrl,
                    entryLocation: entryData.location || null,
                  });

                  updatedSessions[selectedPlant] = plantSessions;

                  // Persistir la actualización
                  AsyncStorage.setItem(
                    `sessions_${userId}`,
                    JSON.stringify(updatedSessions)
                  ).catch((err) =>
                    console.error("❌ Error guardando sesión recreada:", err)
                  );

                  return updatedSessions;
                });

                // Continuar con el registro después de una breve pausa para permitir la actualización
                await new Promise((resolve) => setTimeout(resolve, 300));
                console.log("✅ Sesión recreada exitosamente");
              } else {
                Alert.alert(
                  "Error",
                  "Los datos de la entrada no están completos."
                );
                isRegistering.current = false;
                return;
              }
            } else {
              Alert.alert("Error", "No se encontraron datos de entrada.");
              isRegistering.current = false;
              return;
            }
          } else {
            Alert.alert(
              "Error",
              "Debes registrar una entrada antes de registrar salida."
            );
            isRegistering.current = false;
            return;
          }
        } else if (!entryImage) {
          Alert.alert(
            "Error",
            "Debes registrar una entrada antes de registrar salida."
          );
          isRegistering.current = false;
          return;
        }
      }

      // CAPTURA DE IMAGEN
      const pickerResult = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7, // Mejorado a 0.7 para mejor calidad sin aumentar demasiado el tamaño
        allowsEditing: true,
        aspect: [4, 3],
      });

      if (!pickerResult.assets || pickerResult.assets.length === 0) {
        Alert.alert("Error", "No se capturó ninguna imagen.");
        isRegistering.current = false;
        return;
      }

      const imageUri = pickerResult.assets[0].uri;
      setLoading(true);

      // Generar un ID único para el documento
      const docId = doc(collection(db, "registros")).id;

      // Obtener fecha y hora actual en Colombia
      const timestamp = getColombianTime().toISOString();
      const jornadaFecha = timestamp.split("T")[0]; // YYYY-MM-DD

      // CREACIÓN DE CLAVE PARA ASYNCSTORAGE - OPTIMIZADO PARA PERSISTENCIA
      let imageKey;
      if (actionType === ACTION_ENTRY) {
        // Para entrada: Mantener formato con fecha para permitir múltiples entradas por día
        // pero usar los metadatos para identificar la más reciente
        imageKey = `entryImage_${userId}_${selectedPlant}_${jornadaFecha}`;
      } else {
        // Para salida: Incluir fecha para que sea específica del día
        imageKey = `exitImage_${userId}_${selectedPlant}_${jornadaFecha}`;
      }

      // OBTENER UBICACIÓN
      let location = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const locationResult = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High, // Mayor precisión
            timeout: 10000, // Timeout de 10 segundos para evitar bloqueos
          });

          if (locationResult?.coords) {
            location = {
              latitude: locationResult.coords.latitude,
              longitude: locationResult.coords.longitude,
              accuracy: locationResult.coords.accuracy,
              timestamp: locationResult.timestamp,
            };
          }
        }
      } catch (err) {
        console.log("❌ Error obteniendo ubicación:", err);
        // No bloquear el flujo principal si falla la ubicación
      }

      // GUARDAR METADATOS INICIALES (VERSIÓN LOCAL)
      const metadata = {
        imageUrl: imageUri, // URI local temporal
        plant: selectedPlant,
        timestamp: timestamp,
        jornadaFecha: jornadaFecha,
        location: location,
        deviceInfo: {
          platform: Platform.OS,
          version: Platform.Version,
        },
        createdAt: new Date().toISOString(),
      };

      // GUARDAR EN ASYNCSTORAGE INMEDIATAMENTE (antes de la subida para garantizar persistencia)
      await AsyncStorage.setItem(imageKey, JSON.stringify(metadata));
      console.log(`✅ Imagen guardada localmente con clave: ${imageKey}`);

      // SUBIR IMAGEN A FIREBASE
      const downloadURL = await uploadFile(userId, imageUri, `${docId}.jpg`);

      if (!downloadURL) {
        // MANEJO DE FALLA: Mantener la imagen local si falla la subida
        console.warn("⚠️ No se pudo subir la imagen. Usando versión local.");

        if (actionType === ACTION_ENTRY) {
          setEntryImage(imageUri);
        } else if (actionType === ACTION_EXIT) {
          setExitImage(imageUri);
        }

        // Actualizar sesiones con la imagen local
        setSessions((prevSessions) => {
          const updatedSessions = { ...prevSessions };
          const plantSessions = [...(updatedSessions[selectedPlant] || [])];

          if (actionType === ACTION_ENTRY) {
            plantSessions.push({
              entry: timestamp,
              entryImage: imageUri, // Usar URI local
              entryLocation: location,
              pendingUpload: true, // Marcar para subida posterior
            });
          } else if (actionType === ACTION_EXIT) {
            const lastSessionIndex = plantSessions.length - 1;
            if (lastSessionIndex >= 0) {
              plantSessions[lastSessionIndex] = {
                ...plantSessions[lastSessionIndex],
                exit: timestamp,
                exitImage: imageUri, // Usar URI local
                exitLocation: location,
                pendingUpload: true, // Marcar para subida posterior
              };
            }
          }

          updatedSessions[selectedPlant] = plantSessions;
          AsyncStorage.setItem(
            `sessions_${userId}`,
            JSON.stringify(updatedSessions)
          ).catch((err) => console.error("❌ Error guardando sesiones:", err));

          return updatedSessions;
        });

        Alert.alert(
          "Advertencia",
          "La imagen se guardó localmente, pero no se pudo subir al servidor. Se intentará sincronizar más tarde."
        );

        isRegistering.current = false;
        setLoading(false);
        return;
      }

      // ACTUALIZAR METADATOS CON URL DE FIREBASE
      const updatedMetadata = {
        ...metadata,
        imageUrl: downloadURL,
        uploadedAt: new Date().toISOString(),
        status: "uploaded",
      };

      await AsyncStorage.setItem(imageKey, JSON.stringify(updatedMetadata));
      console.log(`✅ Metadatos actualizados con URL de Firebase: ${imageKey}`);

      // ACTUALIZAR SESIONES
      setSessions((prevSessions) => {
        const updatedSessions = { ...prevSessions };
        const plantSessions = [...(updatedSessions[selectedPlant] || [])];

        if (actionType === ACTION_ENTRY) {
          // Agregar nueva entrada
          plantSessions.push({
            entry: timestamp,
            entryImage: downloadURL,
            entryLocation: location,
            entryKey: imageKey, // Guardar la clave para referencia futura
          });

          // Actualizar UI inmediatamente
          setEntryImage(downloadURL);
          console.log("🖼 Imagen de entrada establecida:", downloadURL);
        } else if (actionType === ACTION_EXIT) {
          // Actualizar la última sesión con datos de salida
          const lastSessionIndex = plantSessions.length - 1;
          if (lastSessionIndex >= 0) {
            plantSessions[lastSessionIndex] = {
              ...plantSessions[lastSessionIndex],
              exit: timestamp,
              exitImage: downloadURL,
              exitLocation: location,
              exitKey: imageKey, // Guardar la clave para referencia futura
            };

            // Actualizar UI inmediatamente
            setExitImage(downloadURL);
            console.log("🖼 Imagen de salida establecida:", downloadURL);
          }
        }

        updatedSessions[selectedPlant] = plantSessions;

        // PERSISTIR SESIONES ACTUALIZADAS
        AsyncStorage.setItem(
          `sessions_${userId}`,
          JSON.stringify(updatedSessions)
        ).catch((err) => console.error("❌ Error guardando sesiones:", err));

        return updatedSessions;
      });

      // ACTUALIZAR ÚLTIMA ACCIÓN
      const actionMessage = `${
        actionType === ACTION_ENTRY ? "Entrada" : "Salida"
      } registrada en ${selectedPlant} a las ${formatDateTime(timestamp)}`;

      setLastAction(actionMessage);
      await AsyncStorage.setItem(`lastAction_${userId}`, actionMessage);

      // ENVIAR NOTIFICACIÓN PARA ENTRADAS (si hay conexión)
      if (actionType === ACTION_ENTRY && navigator.onLine) {
        try {
          const notificacionId = `entrada_${userId}_${Date.now()}`;

          await setDoc(doc(db, "entradasNotificaciones", notificacionId), {
            userId: userId,
            planta: selectedPlant,
            timestamp: timestamp,
            imagenUrl: downloadURL,
            location: location,
            createdAt: new Date().toISOString(),
          });

          console.log("✅ Notificación de entrada enviada");
        } catch (notifError) {
          console.error("❌ Error enviando notificación:", notifError);
          // Continuar sin bloquear el flujo principal
        }
      }

      // MOSTRAR CONFIRMACIÓN AL USUARIO
      Alert.alert(
        "Éxito",
        `Registro de ${
          actionType === ACTION_ENTRY ? "entrada" : "salida"
        } en ${selectedPlant} guardado correctamente.`
      );

      // VERIFICAR SI SE DEBE SINCRONIZAR
      setTimeout(() => {
        NetInfo.fetch().then((state) => {
          if (state.isConnected && state.isInternetReachable !== false) {
            synchronizeWithFirebase().catch((err) => {
              console.warn("⚠️ Error en sincronización en segundo plano:", err);
            });
          }
        });
      }, 2000);
    } catch (error) {
      console.error("❌ Error en registerAction:", error);
      Alert.alert(
        "Error",
        "No se pudo completar el registro. " +
          (error.message || "Inténtalo de nuevo.")
      );
    } finally {
      isRegistering.current = false;
      setLoading(false);
    }
  };

  const cerrarJornada = async () => {
    if (!validarJornadaCompleta()) return;

    try {
      setLoading(true);
      const userId = auth.currentUser?.uid;
      if (!userId) {
        Alert.alert("Error", "No hay usuario autenticado.");
        setLoading(false);
        return;
      }

      // Primero sincronizar con Firebase para asegurar que nada se pierda
      await synchronizeWithFirebase();

      // Obtener la fecha para el cierre de jornada (la más antigua de los registros)
      let fechaJornada = null;
      let fechasRegistradas = new Set();

      // Recorrer todas las sesiones para encontrar las fechas
      Object.values(sessions).forEach((registros) => {
        registros.forEach((session) => {
          if (session.entry) {
            const entryDate = session.entry.split("T")[0];
            fechasRegistradas.add(entryDate);

            if (!fechaJornada || entryDate < fechaJornada) {
              fechaJornada = entryDate;
            }
          }
        });
      });

      if (!fechaJornada) {
        Alert.alert(
          "Error",
          "No se encontró una fecha válida para la jornada."
        );
        setLoading(false);
        return;
      }

      console.log(`📅 Fecha de jornada a cerrar: ${fechaJornada}`);
      console.log(
        `📊 Total fechas registradas: ${[...fechasRegistradas].join(", ")}`
      );

      // Guardar jornada localmente primero (como respaldo)
      const jornadaData = {
        userId,
        fecha: fechaJornada,
        plantas: sessions,
        cerradaLocalmente: true,
        cerradaEn: new Date().toISOString(),
        fechasIncluidas: [...fechasRegistradas],
        dispositivo: Platform.OS,
        horasCalculadas: calcularHorasTotales(sessions),
      };

      const jornadaKey = `jornada_${fechaJornada}_${userId}`;
      await AsyncStorage.setItem(jornadaKey, JSON.stringify(jornadaData));
      console.log(`✅ Jornada guardada localmente con clave: ${jornadaKey}`);

      // Guardar en Firestore con metadatos adicionales
      await setDoc(doc(db, "jornadas", jornadaKey), {
        userId,
        fecha: fechaJornada,
        plantas: sessions,
        cerradaEn: new Date().toISOString(),
        dispositivo: Platform.OS,
        horasCalculadas: calcularHorasTotales(sessions),
        estado: "cerrada",
        fechasIncluidas: [...fechasRegistradas],
        // Metadatos para consultas
        year: new Date(fechaJornada).getFullYear(),
        month: new Date(fechaJornada).getMonth() + 1,
        day: new Date(fechaJornada).getDate(),
      });
      console.log("✅ Jornada guardada en Firestore.");

      // IMPORTANTE: Solo eliminar las imágenes de la jornada cerrada
      // y NO todas las imágenes del usuario
      const allKeys = await AsyncStorage.getAllKeys();

      // Filtrar para obtener solo las claves de imágenes para las fechas en esta jornada
      const jornadaKeys = allKeys.filter((key) => {
        // Verificar que sea una clave de imagen para este usuario
        if (
          !(
            key.startsWith(`entryImage_${userId}_`) ||
            key.startsWith(`exitImage_${userId}_`)
          )
        ) {
          return false;
        }

        // Extraer la fecha de la clave
        const keyParts = key.split("_");
        const keyDate = keyParts[keyParts.length - 1];

        // Solo incluir si la fecha está en las fechas de esta jornada
        return fechasRegistradas.has(keyDate);
      });

      console.log(
        `🧹 Se eliminarán ${jornadaKeys.length} imágenes de jornada cerrada`
      );

      // Eliminar las imágenes de la jornada cerrada
      for (const key of jornadaKeys) {
        await AsyncStorage.removeItem(key);
        console.log(`🗑 Eliminada imagen: ${key}`);
      }

      // Reiniciar el estado de sesiones
      setSessions({ "Planta 1": [], "Planta 2": [] });
      setEntryImage(null);
      setExitImage(null);

      // Guardar el estado limpio en AsyncStorage
      await AsyncStorage.setItem(
        `sessions_${userId}`,
        JSON.stringify({ "Planta 1": [], "Planta 2": [] })
      );

      Alert.alert(
        "Éxito",
        "Jornada cerrada correctamente. Los datos han sido guardados.",
        [{ text: "OK" }]
      );

      // Verificar si hay imágenes que no se eliminaron (para depuración)
      const remainingKeys = await AsyncStorage.getAllKeys();
      const remainingImages = remainingKeys.filter(
        (key) =>
          key.startsWith(`entryImage_${userId}_`) ||
          key.startsWith(`exitImage_${userId}_`)
      );

      if (remainingImages.length > 0) {
        console.log(
          `ℹ️ Imágenes restantes después del cierre: ${remainingImages.length}`
        );
        console.log(remainingImages);
      } else {
        console.log(
          "✅ Todas las imágenes de la jornada fueron eliminadas correctamente"
        );
      }
    } catch (error) {
      console.error("❌ Error al cerrar la jornada:", error);
      Alert.alert(
        "Error",
        "La jornada se ha guardado localmente, pero hubo problemas con la sincronización. Inténtalo nuevamente cuando tengas conexión."
      );
    } finally {
      setLoading(false);
    }
  };

  // Función auxiliar para calcular horas totales trabajadas (para la notificación)
  const calcularHorasTotales = (sessions) => {
    let totalHoras = 0;
    let totalMinutos = 0;

    Object.values(sessions).forEach((plantaSessions) => {
      if (Array.isArray(plantaSessions)) {
        plantaSessions.forEach((session) => {
          if (session.entry && session.exit) {
            try {
              const entryDate = new Date(session.entry);
              const exitDate = new Date(session.exit);
              const diffMs = exitDate - entryDate;

              totalHoras += Math.floor(diffMs / (1000 * 60 * 60));
              totalMinutos += Math.floor(
                (diffMs % (1000 * 60 * 60)) / (1000 * 60)
              );
            } catch (error) {
              console.warn("Error calculando horas:", error);
            }
          }
        });
      }
    });

    // Normalizar minutos
    totalHoras += Math.floor(totalMinutos / 60);
    totalMinutos = totalMinutos % 60;

    return {
      horas: totalHoras,
      minutos: totalMinutos,
      total: `${totalHoras}h ${totalMinutos}m`,
    };
  };

  const loadSessions = async () => {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        console.log("❌ No hay usuario autenticado");
        return;
      }

      console.log("🔄 Iniciando carga de sesiones...");
      setLoading(true);

      // 1. Cargar datos en paralelo para mayor eficiencia
      const [savedSessionsJson, storedPlant] = await Promise.all([
        AsyncStorage.getItem(`sessions_${userId}`),
        AsyncStorage.getItem("selectedPlant"),
      ]);

      // 2. Validar planta seleccionada
      const validPlant =
        storedPlant && ["Planta 1", "Planta 2"].includes(storedPlant)
          ? storedPlant
          : "Planta 1";

      if (validPlant !== storedPlant) {
        await AsyncStorage.setItem("selectedPlant", validPlant);
        console.log(`✅ Planta actualizada a valor válido: ${validPlant}`);
      }

      console.log(`🌱 Planta seleccionada: ${validPlant}`);

      // 3. Procesar datos de sesiones con mejor manejo de errores
      let sessionsData = {
        "Planta 1": [],
        "Planta 2": [],
      };

      if (savedSessionsJson) {
        try {
          // Validar formato del JSON antes de procesar
          if (!savedSessionsJson.trim().startsWith("{")) {
            throw new Error("Formato JSON inválido");
          }

          const parsed = JSON.parse(savedSessionsJson);

          // Normalizar la estructura de datos
          sessionsData = {
            "Planta 1": Array.isArray(parsed["Planta 1"])
              ? parsed["Planta 1"]
              : [],
            "Planta 2": Array.isArray(parsed["Planta 2"])
              ? parsed["Planta 2"]
              : [],
          };

          console.log(
            `📊 Sesiones cargadas - Planta 1: ${sessionsData["Planta 1"].length}, Planta 2: ${sessionsData["Planta 2"].length}`
          );
        } catch (parseError) {
          console.error("❌ Error parseando sesiones:", parseError);

          // Crear respaldo antes de reiniciar
          const backupKey = `sessions_backup_${userId}_${Date.now()}`;
          await AsyncStorage.setItem(backupKey, savedSessionsJson);
          console.log(`⚠️ Datos corruptos respaldados en ${backupKey}`);

          await AsyncStorage.removeItem(`sessions_${userId}`);
        }
      } else {
        console.log("⚠️ No hay sesiones guardadas, usando valores por defecto");
      }

      // 4. Actualizar el estado con los datos procesados
      setSelectedPlant(validPlant);
      setSessions(sessionsData);

      // 5. CRÍTICO: Obtener TODAS las claves de imágenes en AsyncStorage
      const allKeys = await AsyncStorage.getAllKeys();

      // 6. IMPORTANTE: Verificar imágenes por separado, primero desde AsyncStorage
      // que es más confiable que las referencias en sessions

      // Para imágenes de ENTRADA
      const entryKeys = allKeys.filter((key) =>
        key.startsWith(`entryImage_${userId}_${validPlant}_`)
      );

      if (entryKeys.length > 0) {
        console.log(
          `🔍 Encontradas ${entryKeys.length} imágenes de entrada en AsyncStorage`
        );

        // Ordenar cronológicamente (más reciente última)
        entryKeys.sort();
        const latestEntryKey = entryKeys[entryKeys.length - 1];

        try {
          const entryDataJson = await AsyncStorage.getItem(latestEntryKey);
          if (entryDataJson) {
            const entryData = JSON.parse(entryDataJson);
            if (entryData?.imageUrl) {
              // Establecer imagen de entrada DIRECTAMENTE sin verificación previa
              console.log(
                `✅ Cargando imagen de entrada desde AsyncStorage: ${latestEntryKey}`
              );
              setEntryImage(entryData.imageUrl);

              // CRÍTICO: Verificar si necesitamos recrear una sesión con esta imagen
              const plantSessions = sessionsData[validPlant] || [];
              const hasActiveSession = plantSessions.some(
                (s) => s.entry && !s.exit
              );

              if (!hasActiveSession && entryData.imageUrl) {
                console.log(
                  "⚠️ Imagen de entrada sin sesión activa. Recreando sesión..."
                );

                // Recrear sesión con la imagen persistente
                setSessions((prevSessions) => {
                  const updatedSessions = { ...prevSessions };
                  const updatedPlantSessions = [
                    ...(updatedSessions[validPlant] || []),
                  ];

                  updatedPlantSessions.push({
                    entry: entryData.timestamp || new Date().toISOString(),
                    entryImage: entryData.imageUrl,
                    entryLocation: entryData.location || null,
                  });

                  updatedSessions[validPlant] = updatedPlantSessions;

                  // Guardar sesión actualizada
                  AsyncStorage.setItem(
                    `sessions_${userId}`,
                    JSON.stringify(updatedSessions)
                  )
                    .then(() =>
                      console.log("✅ Sesión recreada guardada en AsyncStorage")
                    )
                    .catch((err) =>
                      console.error("❌ Error guardando sesión recreada:", err)
                    );

                  return updatedSessions;
                });
              }
            }
          }
        } catch (entryError) {
          console.error(
            `❌ Error procesando imagen de entrada (${latestEntryKey}):`,
            entryError
          );
        }
      }

      // Para imágenes de SALIDA
      const today = new Date().toISOString().split("T")[0];
      const exitKey = `exitImage_${userId}_${validPlant}_${today}`;

      if (allKeys.includes(exitKey)) {
        try {
          const exitDataJson = await AsyncStorage.getItem(exitKey);
          if (exitDataJson) {
            const exitData = JSON.parse(exitDataJson);
            if (exitData?.imageUrl) {
              console.log(
                `✅ Cargando imagen de salida desde AsyncStorage: ${exitKey}`
              );
              setExitImage(exitData.imageUrl);
            }
          }
        } catch (exitError) {
          console.error(`❌ Error procesando imagen de salida:`, exitError);
        }
      }

      // 7. Respaldo: Si no se encontraron imágenes en AsyncStorage, intentar desde sessions
      if (!entryImage) {
        const plantSessions = sessionsData[validPlant] || [];
        // Buscar la última sesión con entrada (más seguro que findLast para compatibilidad)
        for (let i = plantSessions.length - 1; i >= 0; i--) {
          if (plantSessions[i].entry && plantSessions[i].entryImage) {
            console.log("✅ Cargando imagen de entrada desde sesiones");
            setEntryImage(plantSessions[i].entryImage);
            break;
          }
        }
      }

      if (!exitImage) {
        const plantSessions = sessionsData[validPlant] || [];
        // Buscar la última sesión con salida
        for (let i = plantSessions.length - 1; i >= 0; i--) {
          if (plantSessions[i].exit && plantSessions[i].exitImage) {
            console.log("✅ Cargando imagen de salida desde sesiones");
            setExitImage(plantSessions[i].exitImage);
            break;
          }
        }
      }

      console.log("🔄 Carga de sesiones completada");
    } catch (error) {
      console.error("❌ Error general cargando sesiones:", error);
    } finally {
      setLoading(false);
    }
  };

  const synchronizeWithFirebase = async () => {
    // Validación inicial
    if (!auth.currentUser) {
      console.log("❌ No hay usuario autenticado para sincronizar");
      return false;
    }

    const userId = auth.currentUser.uid;
    setLoading(true); // Mostrar indicador de carga

    try {
      // 1. Verificación básica de conectividad con NetInfo
      const netInfoState = await NetInfo.fetch();
      if (!netInfoState.isConnected) {
        console.log("📵 Sin conexión a internet");
        setLoading(false);
        return false;
      }

      console.log("📡 Conexión detectada: wifi, alcanzable: true");

      // 2. Verificar acceso a Firestore usando un documento específico
      try {
        console.log("🔄 Verificando acceso a Firebase...");

        const testRef = doc(db, "_connection_test", "status");
        await Promise.race([
          getDoc(testRef),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 5000)
          ),
        ]);

        console.log("✅ Conexión a Firebase establecida");
      } catch (error) {
        // CORRECCIÓN IMPORTANTE: Capturar el código de error específico
        console.error("❌ Firebase no accesible:", error.code || error.message);
        setLoading(false);
        return false;
      }

      // 3. Sincronizar imágenes pendientes
      const allKeys = await AsyncStorage.getAllKeys();
      const pendingKeys = allKeys.filter(
        (key) =>
          (key.startsWith(`entryImage_${userId}_`) ||
            key.startsWith(`exitImage_${userId}_`)) &&
          key.includes("_")
      );

      console.log(
        `📊 Encontradas ${pendingKeys.length} imágenes para sincronizar`
      );

      let syncedCount = 0;

      // 4. CORRECCIÓN: Procesar cada imagen con manejo de errores individualizado
      for (const key of pendingKeys) {
        try {
          const dataJson = await AsyncStorage.getItem(key);
          if (!dataJson) continue;

          const data = JSON.parse(dataJson);

          // Solo subir imágenes que son rutas locales (file://)
          if (data?.imageUrl && data.imageUrl.startsWith("file://")) {
            console.log(`🔄 Sincronizando imagen: ${key}`);

            // 5. CORRECCIÓN: Usar un nombre seguro único para el archivo
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 9);
            const safeKey = key.replace(/[^a-zA-Z0-9]/g, "_");
            const filename = `${safeKey}_${timestamp}_${randomId}.jpg`;

            // 6. CORRECCIÓN: Usar la función uploadFile mejorada
            const downloadURL = await uploadFile(
              userId,
              data.imageUrl,
              filename
            );

            if (downloadURL) {
              // 7. CORRECCIÓN: Actualizar AsyncStorage con URL completa
              data.imageUrl = downloadURL;
              data.syncedAt = new Date().toISOString();
              data.syncStatus = "completed";
              await AsyncStorage.setItem(key, JSON.stringify(data));

              syncedCount++;

              // 8. CORRECCIÓN: Actualizar imágenes en UI si corresponde a la planta actual
              if (key.includes(`_${selectedPlant}_`)) {
                if (key.startsWith("entryImage_")) {
                  setEntryImage(downloadURL);
                } else if (key.startsWith("exitImage_")) {
                  setExitImage(downloadURL);
                }
              }

              console.log(`✅ Imagen sincronizada: ${key}`);
            } else {
              console.warn(`⚠️ No se pudo obtener URL para ${key}`);
            }
          }
        } catch (error) {
          console.error(`❌ Error procesando ${key}:`, error.message);
        }
      }

      // 9. CORRECCIÓN: Sincronizar sesiones completas con Firestore
      try {
        const sessionsData = await AsyncStorage.getItem(`sessions_${userId}`);
        if (sessionsData) {
          const parsedSessions = JSON.parse(sessionsData);
          const completeSessions = [];

          // Filtrar solo sesiones completas con URLs de Firebase
          Object.entries(parsedSessions).forEach(([plant, plantSessions]) => {
            if (Array.isArray(plantSessions)) {
              plantSessions.forEach((session) => {
                // Solo sincronizar sesiones completas con imágenes URL (no file://)
                if (
                  session.entry &&
                  session.exit &&
                  session.entryImage &&
                  session.exitImage &&
                  !session.entryImage.startsWith("file://") &&
                  !session.exitImage.startsWith("file://")
                ) {
                  // Agregar metadatos adicionales
                  completeSessions.push({
                    ...session,
                    userId,
                    plant,
                    syncedAt: new Date().toISOString(),
                    device: Platform.OS,
                    appVersion: "1.0",
                  });
                }
              });
            }
          });

          console.log(
            `🔄 Sincronizando ${completeSessions.length} sesiones completas`
          );

          // Subir cada sesión
          for (const session of completeSessions) {
            try {
              const docId = `${userId}_${Date.now()}_${Math.random()
                .toString(36)
                .substring(2, 8)}`;
              await setDoc(doc(db, "registros", docId), session);
              console.log(`✅ Sesión sincronizada con ID: ${docId}`);
            } catch (sessionError) {
              console.error("❌ Error subiendo sesión:", sessionError.message);
            }
          }
        }
      } catch (sessionsError) {
        console.error("❌ Error procesando sesiones:", sessionsError.message);
      }

      console.log("✅ Sincronización completada");
      return true;
    } catch (error) {
      console.error("❌ Error general en sincronización:", error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log("🖼 Imagen de entrada en estado actualizado:", entryImage);
  }, [entryImage]);

  useEffect(() => {
    console.log("🖼 Imagen de salida en estado actualizado:", exitImage);
  }, [exitImage]);

  const goToCalcularHoras = () => {
    if (!sessions || Object.keys(sessions).length === 0) {
      Alert.alert("Error", "No hay datos de registros para calcular horas.");
      return;
    }

    let totalHoras = 0;
    let totalMinutos = 0;

    Object.entries(sessions).forEach(([plant, plantSessions]) => {
      if (!Array.isArray(plantSessions)) return;

      plantSessions.forEach((session) => {
        if (session.entry && session.exit) {
          const entryTime = new Date(session.entry);
          const exitTime = new Date(session.exit);

          if (!isNaN(entryTime) && !isNaN(exitTime)) {
            const diffMs = exitTime - entryTime;
            const diffMinutes = diffMs / (1000 * 60);

            totalHoras += Math.floor(diffMinutes / 60);
            totalMinutos += diffMinutes % 60;
          } else {
            console.warn(
              `⚠ Fechas inválidas en la sesión de ${plant}:`,
              session
            );
          }
        }
      });
    });

    // 🔄 Convertir los minutos extra en horas adicionales
    const horasExtras = Math.floor(totalMinutos / 60);
    totalHoras += horasExtras;
    totalMinutos = totalMinutos % 60;

    console.log(`⏳ Total horas trabajadas: ${totalHoras}h ${totalMinutos}m`);

    // 🔄 Navegar a la pantalla de cálculo con el total de horas
    navigation.navigate("CalcularHoras", {
      totalHoras: totalHoras,
      totalMinutos: totalMinutos,
    });
  };

  const formatColombianDateTime = (date, showSeconds = false) => {
    if (!date) return "N/A";

    return new Date(date).toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      hour12: true,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(showSeconds && { second: "2-digit" }), // 🔥 Muestra segundos solo si `showSeconds` es `true`
    });
  };

  const validarJornadaCompleta = () => {
    let isValid = true;
    const plantasConProblemas = [];

    // ✅ Solo validar las plantas donde el usuario trabajó
    Object.entries(sessions).forEach(([plant, sessionsList]) => {
      const tieneEntradaSinSalida = sessionsList.some(
        (s) => s.entry && !s.exit
      );
      if (tieneEntradaSinSalida) {
        isValid = false;
        plantasConProblemas.push(plant);
      }
    });

    if (!isValid) {
      Alert.alert(
        "Error al cerrar jornada",
        `Debes registrar salida en: ${plantasConProblemas.join(", ")}`
      );
    }
    return isValid;
  };

  const calcularHorasHabilitado = useMemo(() => {
    return Object.values(sessions).some(
      (records) =>
        Array.isArray(records) &&
        records.some((session) => session.entry && session.exit)
    );
  }, [sessions]);

  const guardarSesionEnStorage = async () => {
    try {
      const userId = auth.currentUser?.uid;
      await AsyncStorage.setItem(
        `sessions_${userId}`,
        JSON.stringify(sessions)
      );
    } catch (error) {
      console.error("Error al guardar la sesión:", error);
    }
  };

  // Efecto para guardar sesiones cuando cambian
  useEffect(() => {
    const saveSessionsToStorage = async () => {
      try {
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        await AsyncStorage.setItem(
          `sessions_${userId}`,
          JSON.stringify(sessions)
        );
        console.log("✅ Datos guardados automáticamente");
      } catch (error) {
        console.error("❌ Error guardando sesiones:", error);
      }
    };

    // Usar debounce para evitar múltiples escrituras
    const debounceTimeout = setTimeout(saveSessionsToStorage, 300);

    return () => clearTimeout(debounceTimeout);
  }, [sessions]);

  // Efecto para cargar preferencias al iniciar
  useEffect(() => {
    let isMounted = true;
    let timeout = null;

    const loadInitialPreferences = async () => {
      try {
        const userId = auth.currentUser?.uid;
        if (!userId) {
          console.log("⚠️ No hay usuario autenticado al cargar preferencias");
          return;
        }

        // Cargar planta seleccionada
        const storedPlant = await AsyncStorage.getItem("selectedPlant");
        if (
          storedPlant &&
          ["Planta 1", "Planta 2"].includes(storedPlant) &&
          isMounted
        ) {
          setSelectedPlant(storedPlant);
          console.log(`🌱 Planta cargada: ${storedPlant}`);

          // Solo cargar imágenes después de actualizar planta (evita carreras)
          timeout = setTimeout(async () => {
            if (isMounted) {
              console.log("🔍 Verificando imágenes después de cargar planta");
              await checkEntryImage();
            }
          }, 300);
        }
      } catch (error) {
        console.error("❌ Error cargando preferencias iniciales:", error);
      }
    };

    loadInitialPreferences();

    return () => {
      isMounted = false;
      if (timeout) clearTimeout(timeout);
    };
  }, []); // Solo se ejecuta al montar el componente

  // 2. checkEntryImage
  const checkEntryImage = async () => {
    if (!auth.currentUser) return;
    const userId = auth.currentUser.uid;

    try {
      console.log(`🔍 Verificando imágenes para ${selectedPlant}...`);

      // 1. Obtener todas las claves de AsyncStorage
      const allKeys = await AsyncStorage.getAllKeys();

      // 2. Filtrar claves de imágenes de entrada para esta planta específica
      const entryKeys = allKeys.filter((key) =>
        key.startsWith(`entryImage_${userId}_${selectedPlant}_`)
      );

      console.log(
        `🔍 Encontradas ${entryKeys.length} claves para ${selectedPlant}`
      );

      if (entryKeys.length === 0) {
        console.log(`ℹ️ No hay imágenes para ${selectedPlant}`);
        setEntryImage(null);
        return;
      }

      // 3. Ordenar por fecha para obtener la más reciente
      entryKeys.sort((a, b) => {
        try {
          const dateA = a.split("_").pop(); // Obtener YYYY-MM-DD
          const dateB = b.split("_").pop();
          // Ordena descendente para que la más reciente sea la primera
          return dateB.localeCompare(dateA);
        } catch (error) {
          console.warn("⚠️ Error ordenando fechas:", error);
          return 0;
        }
      });

      const latestKey = entryKeys[0];
      console.log(`✅ Usando clave más reciente: ${latestKey}`);

      // 4. Obtener los datos almacenados con manejo de errores mejorado
      const storedData = await AsyncStorage.getItem(latestKey);
      if (!storedData) {
        console.log(`⚠️ No se encontraron datos para ${latestKey}`);

        // MEJORA: Intentar con la siguiente clave si existe
        if (entryKeys.length > 1) {
          console.log(`🔄 Intentando con clave alternativa...`);
          const backupData = await AsyncStorage.getItem(entryKeys[1]);

          if (!backupData) {
            setEntryImage(null);
            return;
          }

          try {
            const backupEntryData = JSON.parse(backupData);
            if (backupEntryData?.imageUrl) {
              // CORRECCIÓN: Verificar y corregir URL antes de usarla
              let imageUrl = backupEntryData.imageUrl;

              // Corregir URL si es necesario
              if (imageUrl.includes("cys-torres-sas.firebasestorage.app")) {
                imageUrl = imageUrl.replace(
                  "cys-torres-sas.firebasestorage.app",
                  "cys-torres-sas.appspot.com"
                );
                // Actualizar AsyncStorage con la URL corregida
                backupEntryData.imageUrl = imageUrl;
                backupEntryData.urlFixed = true;
                await AsyncStorage.setItem(
                  entryKeys[1],
                  JSON.stringify(backupEntryData)
                );
                console.log(`🔄 URL corregida en clave alternativa`);
              } else if (imageUrl.includes("cys-torres-sas.appspot.com")) {
                // Intentar verificar si esta URL funciona
                try {
                  const response = await fetch(imageUrl, {
                    method: "HEAD",
                    timeout: 3000,
                  });
                  if (response.status === 404) {
                    // Si hay error 404, probar con el dominio alternativo
                    const alternativeUrl = imageUrl.replace(
                      "cys-torres-sas.appspot.com",
                      "cys-torres-sas.firebasestorage.app"
                    );
                    // Verificar si la URL alternativa funciona
                    try {
                      const altResponse = await fetch(alternativeUrl, {
                        method: "HEAD",
                        timeout: 3000,
                      });
                      if (altResponse.ok) {
                        imageUrl = alternativeUrl;
                        backupEntryData.imageUrl = imageUrl;
                        backupEntryData.urlFixed = true;
                        await AsyncStorage.setItem(
                          entryKeys[1],
                          JSON.stringify(backupEntryData)
                        );
                        console.log(
                          `🔄 URL alternativa funciona, usando dominio .firebasestorage.app`
                        );
                      }
                    } catch (altError) {
                      console.log(
                        `⚠️ Error probando URL alternativa: ${altError.message}`
                      );
                    }
                  }
                } catch (fetchError) {
                  console.log(
                    `⚠️ Error verificando URL: ${fetchError.message}`
                  );
                }
              }

              setEntryImage(imageUrl);
              console.log(`✅ Imagen recuperada de clave alternativa`);
            }
          } catch (backupError) {
            console.error(
              `❌ Error procesando clave alternativa:`,
              backupError
            );
            setEntryImage(null);
          }
          return;
        } else {
          setEntryImage(null);
          return;
        }
      }

      // 5. Procesar los datos con validación robusta
      try {
        // Validar que sea un JSON válido
        if (!storedData.trim().startsWith("{")) {
          throw new Error("Formato JSON inválido");
        }

        const entryData = JSON.parse(storedData);

        if (!entryData || typeof entryData !== "object") {
          console.error(`⚠️ Estructura de datos inválida en ${latestKey}`);
          setEntryImage(null);
          return;
        }

        if (!entryData.imageUrl) {
          console.log(`⚠️ URL de imagen no encontrada en ${latestKey}`);
          setEntryImage(null);
          return;
        }

        // CORRECCIÓN: Verificar y corregir la URL de la imagen
        let imageUrl = entryData.imageUrl;
        let urlWasFixed = false;

        // Verificar y corregir URL si contiene el dominio incorrecto
        if (imageUrl.includes("cys-torres-sas.firebasestorage.app")) {
          console.log(
            `🔄 Corrigiendo URL de dominio .firebasestorage.app a .appspot.com`
          );
          imageUrl = imageUrl.replace(
            "cys-torres-sas.firebasestorage.app",
            "cys-torres-sas.appspot.com"
          );
          urlWasFixed = true;
        } else if (imageUrl.includes("cys-torres-sas.appspot.com")) {
          // Verificar si la URL actual funciona
          try {
            console.log(
              `🔍 Verificando si la URL actual funciona: ${imageUrl.substring(
                0,
                50
              )}...`
            );
            const response = await fetch(imageUrl, {
              method: "HEAD",
              timeout: 3000,
            });
            if (response.status === 404) {
              console.log(
                `⚠️ URL con error 404, intentando con dominio alternativo`
              );
              // Si hay error 404, intentar con el otro dominio
              const alternativeUrl = imageUrl.replace(
                "cys-torres-sas.appspot.com",
                "cys-torres-sas.firebasestorage.app"
              );

              // Verificar si la URL alternativa funciona
              try {
                const altResponse = await fetch(alternativeUrl, {
                  method: "HEAD",
                  timeout: 3000,
                });
                if (altResponse.ok) {
                  console.log(`✅ URL alternativa funciona correctamente`);
                  imageUrl = alternativeUrl;
                  urlWasFixed = true;
                }
              } catch (altError) {
                console.log(
                  `⚠️ Error probando URL alternativa: ${altError.message}`
                );
                // Continuar con la URL original a pesar del error
              }
            } else {
              console.log(`✅ URL actual funciona correctamente`);
            }
          } catch (fetchError) {
            console.log(`⚠️ Error al verificar URL: ${fetchError.message}`);
            // Intentar con la versión alternativa por si acaso
            const alternativeUrl = imageUrl.replace(
              "cys-torres-sas.appspot.com",
              "cys-torres-sas.firebasestorage.app"
            );
            imageUrl = alternativeUrl;
            urlWasFixed = true;
            console.log(`🔄 Usando URL alternativa debido a error de conexión`);
          }
        }

        // Actualizar AsyncStorage si la URL fue corregida
        if (urlWasFixed) {
          entryData.imageUrl = imageUrl;
          entryData.urlFixed = true;
          entryData.fixedAt = new Date().toISOString();
          await AsyncStorage.setItem(latestKey, JSON.stringify(entryData));
          console.log(
            `✅ URL actualizada en AsyncStorage: ${imageUrl.substring(
              0,
              50
            )}...`
          );
        }

        // 6. CRÍTICO: Establecer la imagen inmediatamente
        console.log(`🖼️ Estableciendo imagen: ${imageUrl.substring(0, 40)}...`);
        setEntryImage(imageUrl);

        // 7. Verificar consistencia con las sesiones
        const plantSessions = sessions[selectedPlant] || [];
        const hasActiveSession = plantSessions.some((s) => s.entry && !s.exit);

        // 8. RECUPERACIÓN: Si hay imagen persistente sin sesión activa, recrearla
        if (!hasActiveSession && imageUrl) {
          console.log(
            `🔄 Imagen encontrada sin sesión activa. Recreando sesión...`
          );

          setSessions((prevSessions) => {
            const updatedSessions = { ...prevSessions };
            const updatedPlantSessions = [
              ...(updatedSessions[selectedPlant] || []),
            ];

            // Evitar duplicados verificando si ya existe una entrada similar
            const entryExists = updatedPlantSessions.some(
              (session) =>
                session.entryImage === imageUrl ||
                (session.entry &&
                  entryData.timestamp &&
                  new Date(session.entry).getTime() ===
                    new Date(entryData.timestamp).getTime())
            );

            if (!entryExists) {
              // Añadir la sesión con todos los datos disponibles
              updatedPlantSessions.push({
                entry: entryData.timestamp || new Date().toISOString(),
                entryImage: imageUrl, // Usar la URL corregida
                entryLocation: entryData.location || null,
                plant: selectedPlant,
                recreatedAt: new Date().toISOString(), // Marcar como recreada
              });

              updatedSessions[selectedPlant] = updatedPlantSessions;

              // Guardar sesiones actualizadas inmediatamente
              AsyncStorage.setItem(
                `sessions_${userId}`,
                JSON.stringify(updatedSessions)
              )
                .then(() => console.log(`✅ Sesión recreada exitosamente`))
                .catch((error) => {
                  console.error(`❌ Error guardando sesión recreada:`, error);
                  // Reintento en caso de fallo
                  setTimeout(() => {
                    AsyncStorage.setItem(
                      `sessions_${userId}`,
                      JSON.stringify(updatedSessions)
                    ).catch((e) =>
                      console.error("Error en segundo intento:", e)
                    );
                  }, 1000);
                });
            } else {
              console.log(`ℹ️ La sesión ya existe, evitando duplicado`);
            }

            return updatedSessions;
          });
        }

        // 9. MEJORA: También verificar existencia de imagen de salida para UI completa
        try {
          const today = new Date().toISOString().split("T")[0];
          const exitKey = `exitImage_${userId}_${selectedPlant}_${today}`;

          if (allKeys.includes(exitKey)) {
            const exitDataJson = await AsyncStorage.getItem(exitKey);
            if (exitDataJson) {
              const exitData = JSON.parse(exitDataJson);
              if (exitData?.imageUrl) {
                // CORRECCIÓN: Verificar y corregir URL de la imagen de salida
                let exitImageUrl = exitData.imageUrl;
                let exitUrlWasFixed = false;

                // Mismo proceso de corrección que para la imagen de entrada
                if (
                  exitImageUrl.includes("cys-torres-sas.firebasestorage.app")
                ) {
                  exitImageUrl = exitImageUrl.replace(
                    "cys-torres-sas.firebasestorage.app",
                    "cys-torres-sas.appspot.com"
                  );
                  exitUrlWasFixed = true;
                } else if (
                  exitImageUrl.includes("cys-torres-sas.appspot.com")
                ) {
                  try {
                    const response = await fetch(exitImageUrl, {
                      method: "HEAD",
                      timeout: 3000,
                    });
                    if (response.status === 404) {
                      const alternativeUrl = exitImageUrl.replace(
                        "cys-torres-sas.appspot.com",
                        "cys-torres-sas.firebasestorage.app"
                      );
                      try {
                        const altResponse = await fetch(alternativeUrl, {
                          method: "HEAD",
                          timeout: 3000,
                        });
                        if (altResponse.ok) {
                          exitImageUrl = altResponse;
                          exitUrlWasFixed = true;
                        }
                      } catch (altError) {
                        console.log(
                          `⚠️ Error probando URL alternativa: ${altError.message}`
                        );
                      }
                    }
                  } catch (fetchError) {
                    // En caso de error, intentar con el dominio alternativo
                    const alternativeUrl = exitImageUrl.replace(
                      "cys-torres-sas.appspot.com",
                      "cys-torres-sas.firebasestorage.app"
                    );
                    exitImageUrl = alternativeUrl;
                    exitUrlWasFixed = true;
                  }
                }

                // Actualizar AsyncStorage si la URL de salida fue corregida
                if (exitUrlWasFixed) {
                  exitData.imageUrl = exitImageUrl;
                  exitData.urlFixed = true;
                  exitData.fixedAt = new Date().toISOString();
                  await AsyncStorage.setItem(exitKey, JSON.stringify(exitData));
                  console.log(`✅ URL de salida actualizada en AsyncStorage`);
                }

                console.log(`🖼️ También cargando imagen de salida corregida`);
                setExitImage(exitImageUrl);
              }
            }
          }
        } catch (exitError) {
          console.warn(`⚠️ Error procesando imagen de salida:`, exitError);
          // No bloqueante - continuar sin imagen de salida si falla
        }
      } catch (parseError) {
        console.error(`❌ Error parseando datos:`, parseError);

        // MEJORA: No resetear la imagen actual si ya hay una cargada
        if (!entryImage) {
          setEntryImage(null);
        } else {
          console.log(`ℹ️ Manteniendo imagen actual debido a error de parseo`);
        }
      }
    } catch (error) {
      console.error(`❌ Error general en checkEntryImage:`, error);

      // MEJORA: Conservar imagen actual en caso de error
      if (!entryImage) {
        setEntryImage(null);
      }
    }
  };

  
  // Esta función se llamaría si una imagen falla al cargar
  const recoverFailedImage = async (imageUrl, imageType) => {
    if (!imageUrl) return null;

    try {
      console.log(`🔄 Intentando recuperar imagen fallida: ${imageType}`);

      // Intentar con el dominio alternativo
      let alternativeUrl;
      if (imageUrl.includes("cys-torres-sas.appspot.com")) {
        alternativeUrl = imageUrl.replace(
          "cys-torres-sas.appspot.com",
          "cys-torres-sas.firebasestorage.app"
        );
      } else if (imageUrl.includes("cys-torres-sas.firebasestorage.app")) {
        alternativeUrl = imageUrl.replace(
          "cys-torres-sas.firebasestorage.app",
          "cys-torres-sas.appspot.com"
        );
      }

      if (!alternativeUrl) return null;

      // Verificar si la URL alternativa funciona
      try {
        const response = await fetch(alternativeUrl, { method: "HEAD" });
        if (response.ok) {
          console.log(
            `✅ URL alternativa funciona, actualizando imagen ${imageType}`
          );

          // Si es imagen de entrada, actualizar en AsyncStorage
          if (imageType === "entry") {
            const userId = auth.currentUser?.uid;
            const allKeys = await AsyncStorage.getAllKeys();
            const entryKeys = allKeys.filter((key) =>
              key.startsWith(`entryImage_${userId}_${selectedPlant}_`)
            );

            if (entryKeys.length > 0) {
              // Ordenar por fecha para obtener la más reciente
              entryKeys.sort((a, b) => {
                const dateA = a.split("_").pop();
                const dateB = b.split("_").pop();
                return dateB.localeCompare(dateA);
              });

              // Actualizar la URL en el registro correspondiente
              const latestEntryKey = entryKeys[0];
              const entryDataJson = await AsyncStorage.getItem(latestEntryKey);

              if (entryDataJson) {
                const entryData = JSON.parse(entryDataJson);
                if (entryData && entryData.imageUrl === imageUrl) {
                  entryData.imageUrl = alternativeUrl;
                  entryData.urlRecovered = true;
                  entryData.recoveredAt = new Date().toISOString();
                  await AsyncStorage.setItem(
                    latestEntryKey,
                    JSON.stringify(entryData)
                  );
                  console.log(
                    `✅ URL actualizada en AsyncStorage: ${latestEntryKey}`
                  );
                }
              }
            }

            // Actualizar en las sesiones
            setSessions((prevSessions) => {
              const updatedSessions = { ...prevSessions };
              const plantSessions = updatedSessions[selectedPlant] || [];

              // Buscar la sesión con la imagen fallida
              const updatedPlantSessions = plantSessions.map((session) => {
                if (session.entryImage === imageUrl) {
                  return {
                    ...session,
                    entryImage: alternativeUrl,
                  };
                }
                return session;
              });

              updatedSessions[selectedPlant] = updatedPlantSessions;

              // Guardar sesiones actualizadas
              const userId = auth.currentUser?.uid;
              if (userId) {
                AsyncStorage.setItem(
                  `sessions_${userId}`,
                  JSON.stringify(updatedSessions)
                ).catch((err) =>
                  console.error(`❌ Error guardando sesiones:`, err)
                );
              }

              return updatedSessions;
            });
          } else if (imageType === "exit") {
            // Lógica similar para imagen de salida
            const userId = auth.currentUser?.uid;
            const today = new Date().toISOString().split("T")[0];
            const exitKey = `exitImage_${userId}_${selectedPlant}_${today}`;

            const exitDataJson = await AsyncStorage.getItem(exitKey);
            if (exitDataJson) {
              const exitData = JSON.parse(exitDataJson);
              if (exitData && exitData.imageUrl === imageUrl) {
                exitData.imageUrl = alternativeUrl;
                exitData.urlRecovered = true;
                exitData.recoveredAt = new Date().toISOString();
                await AsyncStorage.setItem(exitKey, JSON.stringify(exitData));
                console.log(`✅ URL de salida actualizada en AsyncStorage`);
              }
            }

            // Actualizar en las sesiones
            setSessions((prevSessions) => {
              const updatedSessions = { ...prevSessions };
              const plantSessions = updatedSessions[selectedPlant] || [];

              // Buscar la sesión con la imagen fallida
              const updatedPlantSessions = plantSessions.map((session) => {
                if (session.exitImage === imageUrl) {
                  return {
                    ...session,
                    exitImage: alternativeUrl,
                  };
                }
                return session;
              });

              updatedSessions[selectedPlant] = updatedPlantSessions;

              // Guardar sesiones actualizadas
              AsyncStorage.setItem(
                `sessions_${userId}`,
                JSON.stringify(updatedSessions)
              ).catch((err) =>
                console.error(`❌ Error guardando sesiones:`, err)
              );

              return updatedSessions;
            });
          }

          return alternativeUrl;
        }
      } catch (error) {
        console.log(`⚠️ La URL alternativa tampoco funciona: ${error.message}`);
      }

      return null;
    } catch (error) {
      console.error(`❌ Error en recuperación de imagen:`, error);
      return null;
    }
  };

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        const storedSessions = await AsyncStorage.getItem(`sessions_${userId}`);
        const storedPlant = await AsyncStorage.getItem("selectedPlant");

        if (storedSessions) {
          const parsedSessions = JSON.parse(storedSessions);
          setSessions({
            "Planta 1": Array.isArray(parsedSessions["Planta 1"])
              ? parsedSessions["Planta 1"]
              : [],
            "Planta 2": Array.isArray(parsedSessions["Planta 2"])
              ? parsedSessions["Planta 2"]
              : [],
          });
          // Obtener la última entrada y salida de la planta almacenada
          const plantSessions =
            parsedSessions[storedPlant || selectedPlant] || [];
          const lastEntry = plantSessions.findLast((s) => s.entry);
          const lastExit = plantSessions.findLast((s) => s.exit);

          // Actualizar imágenes
          setEntryImage(lastEntry?.entryImage || null);
          setExitImage(lastExit?.exitImage || null);
          // ==== FIN DE CAMBIOS SOLICITADOS ==== //
        }

        if (storedPlant) {
          setSelectedPlant(storedPlant);
        }

        // 🔄 Asegurar que checkEntryImage se ejecuta después de actualizar el estado
        setTimeout(() => {
          checkEntryImage();
        }, 500);
      } catch (error) {
        console.error("❌ Error al cargar sesiones:", error);
      }
    };

    loadSessions();
  }, []);

  const formatDateTime = (isoString) => {
    if (!isoString) return "N/A";
    const date = new Date(isoString);
    return date.toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const calculateDuration = (entry, exit) => {
    if (!entry || !exit) return "En progreso";

    try {
      // Asegurar que entry y exit son objetos Date válidos
      const entryDate = entry instanceof Date ? entry : new Date(entry);
      const exitDate = exit instanceof Date ? exit : new Date(exit);

      if (isNaN(entryDate.getTime()) || isNaN(exitDate.getTime())) {
        return "Error en fecha";
      }

      // Calcular diferencia en milisegundos
      const diffMs = exitDate - entryDate;

      // Convertir a horas y minutos
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      return `${diffHours}h ${diffMinutes}m`;
    } catch (error) {
      console.error("Error calculando duración:", error);
      return "Error";
    }
  };

  const handlePlantSelection = async (value) => {
    // 1. Validación inicial de valores permitidos
    if (!["Planta 1", "Planta 2"].includes(value)) {
      console.warn(`⚠️ Intento de seleccionar planta inválida: ${value}`);
      return;
    }

    console.log(`🔄 Intentando cambiar a ${value} desde ${selectedPlant}`);

    // 2. Bloquear cambio si hay entrada sin salida en la planta ACTUAL
    const lastSession =
      sessions[selectedPlant]?.[sessions[selectedPlant].length - 1];
    if (lastSession && !lastSession.exit) {
      Alert.alert(
        "Planta en uso",
        "Debe registrar salida antes de cambiar de planta.",
        [{ text: "Entendido" }]
      );
      return;
    }

    // 3. Bloquear el cambio si hay entrada sin salida en la planta DESTINO
    const lastSessionNewPlant = sessions[value]?.[sessions[value].length - 1];
    if (lastSessionNewPlant && !lastSessionNewPlant.exit) {
      Alert.alert(
        "Planta en uso",
        "Debe registrar salida antes de cambiar de planta.",
        [{ text: "Entendido" }]
      );
      return;
    }

    // 4. Si pasamos todas las validaciones, proceder con el cambio
    try {
      // Antes del cambio: guardar el estado actual de imágenes para evitar parpadeos
      const prevEntryImage = entryImage;
      const prevExitImage = exitImage;

      // Guardar la planta seleccionada en AsyncStorage
      await AsyncStorage.setItem("selectedPlant", value);
      console.log(`✅ Planta ${value} guardada en AsyncStorage`);

      // Actualizar estado en componente inmediatamente
      setSelectedPlant(value);

      // CRÍTICO: Limpiar imágenes temporalmente durante la transición para evitar mostrar
      // momentáneamente las imágenes de la planta anterior en los contenedores de la nueva planta
      setEntryImage(null);
      setExitImage(null);

      // Actualizar estructura de sesiones asegurándonos de mantener todos los datos
      setSessions((prevSessions) => {
        const updatedSessions = {
          ...prevSessions,
          [value]: prevSessions[value] || [], // Asegurar que existe la estructura para la nueva planta
        };

        // Actualizar sesiones en AsyncStorage en segundo plano
        const userId = auth.currentUser?.uid;
        if (userId) {
          AsyncStorage.setItem(
            `sessions_${userId}`,
            JSON.stringify(updatedSessions)
          )
            .then(() =>
              console.log(`✅ Datos de sesiones actualizados para ${value}`)
            )
            .catch((err) => console.error("❌ Error guardando sesiones:", err));
        }

        return updatedSessions;
      });

      // 5. CLAVE: Verificación robusta de imágenes correspondientes a la nueva planta
      // Wrap this in a try-catch to ensure transitions complete even if there's an error
      try {
        const userId = auth.currentUser?.uid;
        if (!userId) {
          console.warn("⚠️ No hay usuario autenticado al cambiar planta");
          return;
        }

        // 5.1. Obtener todas las claves de AsyncStorage
        const allKeys = await AsyncStorage.getAllKeys();

        // 5.2. Filtrar solo las imágenes de entrada para la NUEVA planta
        const entryKeys = allKeys.filter((key) =>
          key.startsWith(`entryImage_${userId}_${value}_`)
        );

        console.log(
          `🔍 Encontradas ${entryKeys.length} imágenes de entrada para ${value}`
        );

        // 5.3. Si hay imágenes de entrada, buscar la más reciente
        if (entryKeys.length > 0) {
          // Ordenar por fecha (más reciente primero)
          entryKeys.sort((a, b) => {
            const dateA = a.split("_").pop();
            const dateB = b.split("_").pop();
            return dateB.localeCompare(dateA);
          });

          const latestEntryKey = entryKeys[0];
          console.log(`✅ Usando imagen más reciente: ${latestEntryKey}`);

          // 5.4. Cargar los datos de la imagen de entrada
          const entryDataJson = await AsyncStorage.getItem(latestEntryKey);
          if (entryDataJson) {
            const entryData = JSON.parse(entryDataJson);

            // Si hay URL de imagen válida, establecerla
            if (entryData?.imageUrl) {
              // CORRECCIÓN: Comprobar y corregir la URL según el dominio
              let imageUrl = entryData.imageUrl;

              // Intentar corregir URL si corresponde a un dominio incorrecto
              if (imageUrl.includes("cys-torres-sas.firebasestorage.app")) {
                imageUrl = imageUrl.replace(
                  "cys-torres-sas.firebasestorage.app",
                  "cys-torres-sas.appspot.com"
                );
                // Actualizar la URL en AsyncStorage para futuras referencias
                entryData.imageUrl = imageUrl;
                entryData.urlFixed = true;
                await AsyncStorage.setItem(
                  latestEntryKey,
                  JSON.stringify(entryData)
                );
                console.log(`🔄 URL corregida para ${latestEntryKey}`);
              } else if (imageUrl.includes("cys-torres-sas.appspot.com")) {
                // Verificar si esta URL funciona
                try {
                  const response = await fetch(imageUrl, {
                    method: "HEAD",
                    timeout: 3000,
                  });
                  if (response.status === 404) {
                    // Si hay error 404, intentar con el dominio alternativo
                    const alternativeUrl = imageUrl.replace(
                      "cys-torres-sas.appspot.com",
                      "cys-torres-sas.firebasestorage.app"
                    );
                    // Verificar si la alternativa funciona
                    try {
                      const altResponse = await fetch(alternativeUrl, {
                        method: "HEAD",
                        timeout: 3000,
                      });
                      if (altResponse.ok) {
                        imageUrl = alternativeUrl;
                        entryData.imageUrl = imageUrl;
                        entryData.urlFixed = true;
                        await AsyncStorage.setItem(
                          latestEntryKey,
                          JSON.stringify(entryData)
                        );
                        console.log(
                          `🔄 URL alternativa funciona, usando: ${alternativeUrl.substring(
                            0,
                            30
                          )}...`
                        );
                      }
                    } catch (altError) {
                      console.log(
                        `⚠️ Error probando URL alternativa: ${altError.message}`
                      );
                    }
                  }
                } catch (fetchError) {
                  console.log(
                    `⚠️ Error verificando URL original: ${fetchError.message}`
                  );
                  // En caso de error de red, intentamos con la otra versión anyway
                  try {
                    const alternativeUrl = imageUrl.replace(
                      "cys-torres-sas.appspot.com",
                      "cys-torres-sas.firebasestorage.app"
                    );
                    imageUrl = alternativeUrl;
                    entryData.imageUrl = imageUrl;
                    entryData.urlFixed = true;
                    await AsyncStorage.setItem(
                      latestEntryKey,
                      JSON.stringify(entryData)
                    );
                    console.log(
                      `🔄 Usando URL alternativa debido a error: ${alternativeUrl.substring(
                        0,
                        30
                      )}...`
                    );
                  } catch (storeError) {
                    console.error(
                      `❌ Error guardando URL alternativa: ${storeError.message}`
                    );
                  }
                }
              }

              // Establecer la imagen con la URL corregida
              console.log(
                `🖼️ Estableciendo imagen para ${value}: ${imageUrl.slice(
                  0,
                  30
                )}...`
              );
              setEntryImage(imageUrl);

              // 5.5. Verificar si necesitamos recrear una sesión activa
              const plantSessions = sessions[value] || [];
              const hasActiveEntry = plantSessions.some(
                (s) => s.entry && !s.exit
              );

              // Si no hay sesión activa pero hay imagen, reconstruir la sesión
              if (!hasActiveEntry) {
                console.log(
                  `🔄 Reconstruyendo sesión para ${value} con imagen existente`
                );

                // Crear nueva sesión con la imagen encontrada
                setSessions((prevSessions) => {
                  const updatedSessions = { ...prevSessions };
                  const plantSessions = [...(updatedSessions[value] || [])];

                  // Agregar la entrada con los datos disponibles
                  plantSessions.push({
                    entry: entryData.timestamp || new Date().toISOString(),
                    entryImage: imageUrl, // Usar URL corregida
                    entryLocation: entryData.location || null,
                    plant: value,
                    recreatedAt: new Date().toISOString(), // Para seguimiento de recreaciones
                  });

                  updatedSessions[value] = plantSessions;

                  // Persistir actualizaciones
                  if (userId) {
                    AsyncStorage.setItem(
                      `sessions_${userId}`,
                      JSON.stringify(updatedSessions)
                    ).catch((err) =>
                      console.error("❌ Error guardando sesión recreada:", err)
                    );
                  }

                  return updatedSessions;
                });
              }
            }
          }
        } else {
          console.log(`ℹ️ No hay imágenes de entrada para ${value}`);
        }

        // 5.6. También verificar imágenes de salida para el día actual
        const today = new Date().toISOString().split("T")[0];
        const exitKey = `exitImage_${userId}_${value}_${today}`;

        if (allKeys.includes(exitKey)) {
          console.log(
            `🔍 Encontrada imagen de salida para ${value}: ${exitKey}`
          );
          const exitDataJson = await AsyncStorage.getItem(exitKey);

          if (exitDataJson) {
            try {
              const exitData = JSON.parse(exitDataJson);
              if (exitData?.imageUrl) {
                // CORRECCIÓN: Similar al código anterior para imágenes de entrada
                let exitImageUrl = exitData.imageUrl;

                if (
                  exitImageUrl.includes("cys-torres-sas.firebasestorage.app")
                ) {
                  exitImageUrl = exitImageUrl.replace(
                    "cys-torres-sas.firebasestorage.app",
                    "cys-torres-sas.appspot.com"
                  );
                  exitData.imageUrl = exitImageUrl;
                  exitData.urlFixed = true;
                  await AsyncStorage.setItem(exitKey, JSON.stringify(exitData));
                  console.log(`🔄 URL de salida corregida para ${exitKey}`);
                } else if (
                  exitImageUrl.includes("cys-torres-sas.appspot.com")
                ) {
                  // Verificación similar para URL de salida
                  try {
                    const response = await fetch(exitImageUrl, {
                      method: "HEAD",
                      timeout: 3000,
                    });
                    if (response.status === 404) {
                      const altExitUrl = exitImageUrl.replace(
                        "cys-torres-sas.appspot.com",
                        "cys-torres-sas.firebasestorage.app"
                      );
                      try {
                        const altResponse = await fetch(altExitUrl, {
                          method: "HEAD",
                          timeout: 3000,
                        });
                        if (altResponse.ok) {
                          exitImageUrl = altExitUrl;
                          exitData.imageUrl = exitImageUrl;
                          exitData.urlFixed = true;
                          await AsyncStorage.setItem(
                            exitKey,
                            JSON.stringify(exitData)
                          );
                          console.log(
                            `🔄 URL de salida alternativa funciona, usando: ${altExitUrl.substring(
                              0,
                              30
                            )}...`
                          );
                        }
                      } catch (altError) {
                        console.log(
                          `⚠️ Error probando URL de salida alternativa: ${altError.message}`
                        );
                      }
                    }
                  } catch (fetchError) {
                    console.log(
                      `⚠️ Error verificando URL de salida original: ${fetchError.message}`
                    );
                    // Intentar con alternativa en caso de error de red
                    try {
                      const altExitUrl = exitImageUrl.replace(
                        "cys-torres-sas.appspot.com",
                        "cys-torres-sas.firebasestorage.app"
                      );
                      exitImageUrl = altExitUrl;
                      exitData.imageUrl = exitImageUrl;
                      exitData.urlFixed = true;
                      await AsyncStorage.setItem(
                        exitKey,
                        JSON.stringify(exitData)
                      );
                      console.log(
                        `🔄 Usando URL de salida alternativa debido a error: ${altExitUrl.substring(
                          0,
                          30
                        )}...`
                      );
                    } catch (storeError) {
                      console.error(
                        `❌ Error guardando URL de salida alternativa: ${storeError.message}`
                      );
                    }
                  }
                }

                console.log(`🖼️ Estableciendo imagen de salida para ${value}`);
                setExitImage(exitImageUrl);
              }
            } catch (exitError) {
              console.error(`❌ Error procesando imagen de salida:`, exitError);
            }
          }
        } else {
          console.log(`ℹ️ No hay imágenes de salida recientes para ${value}`);
        }
      } catch (loadError) {
        console.error(`❌ Error cargando imágenes para ${value}:`, loadError);

        // FALLBACK: En caso de error en la carga de imágenes,
        // intentar ejecutar checkEntryImage como último recurso
        setTimeout(() => {
          if (selectedPlant === value) {
            // Verificar que no haya cambiado nuevamente
            checkEntryImage().catch((e) =>
              console.error("Error en fallback de checkEntryImage:", e)
            );
          }
        }, 800);
      }

      // 6. MEJORA: Cargar información completa de la planta después de un pequeño retraso
      // para permitir que los estados se actualicen correctamente
      try {
        // Usar un tiempo un poco mayor para asegurar que todas las actualizaciones de estado
        // tengan tiempo de completarse
        setTimeout(async () => {
          if (selectedPlant === value) {
            // Asegurar que la selección no ha cambiado
            // Utilizar la función loadSessions si existe para cargar datos completos
            if (typeof loadSessions === "function") {
              console.log(`🔄 Ejecutando loadSessions() para ${value}`);
              await loadSessions();
            }

            // Segunda verificación de imágenes para garantizar sincronización completa
            console.log(`🔄 Ejecutando checkEntryImage() para ${value}`);
            await checkEntryImage();

            console.log(`✅ Cambio a planta ${value} completado con éxito`);
          }
        }, 600);
      } catch (finalError) {
        console.error("❌ Error en verificación final:", finalError);
      }
    } catch (error) {
      console.error(`❌ Error general al cambiar a planta ${value}:`, error);

      // Mantener la planta actual en caso de fallo
      Alert.alert(
        "Error",
        "No se pudo cambiar de planta. Inténtelo nuevamente."
      );
    }
  };

  const removeEntryImage = async () => {
    // Desactivar el botón de eliminar inmediatamente para evitar doble tap
    setShowDelete(false);

    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        Alert.alert("Error", "No hay usuario autenticado.");
        return;
      }

      console.log("🗑 Iniciando eliminación de imagen de entrada...");

      // PROBLEMA CRÍTICO: Estaba asumiendo fecha actual para eliminar la imagen
      // En lugar de eso, debemos buscar la clave correcta entre todas las posibles

      // 1. Obtener todas las claves en AsyncStorage
      const allKeys = await AsyncStorage.getAllKeys();

      // 2. Encontrar la clave que corresponde a la imagen de entrada actual
      const entryKeys = allKeys.filter((key) =>
        key.startsWith(`entryImage_${userId}_${selectedPlant}_`)
      );

      if (entryKeys.length === 0) {
        Alert.alert("Error", "No se encontró la imagen para eliminar.");
        return;
      }

      console.log(
        `🔍 Encontradas ${entryKeys.length} posibles imágenes para eliminar`
      );

      // 3. Ordenar por fecha para tomar la más reciente
      entryKeys.sort((a, b) => {
        const dateA = a.split("_").pop();
        const dateB = b.split("_").pop();
        return dateB.localeCompare(dateA);
      });

      const keyToRemove = entryKeys[0];
      console.log(`✅ Se eliminará la clave: ${keyToRemove}`);

      // 4. MEJORA: Mantener una referencia a la imagen actual para recuperarla si algo sale mal
      const currentImage = entryImage;

      // 5. Crear una copia de respaldo de los metadatos antes de eliminar
      const backupData = await AsyncStorage.getItem(keyToRemove);

      // 6. Eliminar de AsyncStorage primero (operación más crítica)
      await AsyncStorage.removeItem(keyToRemove);
      console.log(`✅ Imagen eliminada de AsyncStorage: ${keyToRemove}`);

      // 7. Actualizar las sesiones para quitar la referencia a la imagen
      setSessions((prevSessions) => {
        const updatedSessions = { ...prevSessions };

        if (updatedSessions[selectedPlant]?.length > 0) {
          // Identificar la sesión correcta que tiene esta imagen
          const sessionIndex = updatedSessions[selectedPlant].findIndex(
            (session) => session.entryImage === currentImage
          );

          if (sessionIndex !== -1) {
            // Crear copia de la sesión y eliminar la propiedad entryImage
            const updatedSession = {
              ...updatedSessions[selectedPlant][sessionIndex],
            };
            delete updatedSession.entryImage;

            // Actualizar el array de sesiones
            updatedSessions[selectedPlant] = [
              ...updatedSessions[selectedPlant].slice(0, sessionIndex),
              updatedSession,
              ...updatedSessions[selectedPlant].slice(sessionIndex + 1),
            ];
          } else {
            // Si no encontramos la sesión exacta, actualizar la última como antes
            const lastIndex = updatedSessions[selectedPlant].length - 1;
            const { entryImage, ...rest } =
              updatedSessions[selectedPlant][lastIndex];
            updatedSessions[selectedPlant][lastIndex] = rest;
          }
        }

        // Persistir cambios en AsyncStorage
        AsyncStorage.setItem(
          `sessions_${userId}`,
          JSON.stringify(updatedSessions)
        ).catch((e) =>
          console.error("❌ Error guardando sesiones actualizadas:", e)
        );

        return updatedSessions;
      });

      // 8. AHORA limpiar la imagen en UI (después de todas las operaciones críticas)
      setEntryImage(null);

      Alert.alert("Éxito", "Imagen eliminada correctamente.");
      console.log("✅ Proceso de eliminación completado");
    } catch (error) {
      console.error("❌ Error eliminando la imagen:", error);

      // Restaurar UI al estado anterior en caso de error
      setShowDelete(true);

      Alert.alert(
        "Error",
        "No se pudo eliminar la imagen. Intentarlo nuevamente."
      );
    }
  };

  const safeParseDate = (dateString) => {
    if (!dateString) return null; // Evita errores si la fecha es null o undefined
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  };

  const normalizeDate = (dateString) => {
    if (!dateString) return null;

    // Si ya es un objeto Date válido, retornarlo
    if (dateString instanceof Date && !isNaN(dateString)) return dateString;

    // Si es un timestamp numérico
    if (!isNaN(dateString)) return new Date(parseInt(dateString, 10));

    // Si tiene formato incorrecto, intentar convertirlo
    const parsedDate = new Date(dateString);
    return isNaN(parsedDate.getTime()) ? null : parsedDate;
  };

  if (!isAuthReady) {
    return <ActivityIndicator size="large" style={{ flex: 1 }} />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => setRefreshing(false)}
        />
      }
    >
      <Text style={styles.title}>Registro Horario</Text>
      <Text style={styles.subtitle}>Seleccione Planta</Text>
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={selectedPlant}
          style={styles.picker}
          onValueChange={handlePlantSelection}
          dropdownIconColor="#fff"
        >
          <Picker.Item
            label={`Planta 1 ${
              (Array.isArray(sessions["Planta 1"])
                ? sessions["Planta 1"]
                : []
              ).some((s) => s.exit)
                ? "✓"
                : "⏳"
            }`}
            value="Planta 1"
            disabled={(Array.isArray(sessions["Planta 1"])
              ? sessions["Planta 1"]
              : []
            ).some((s) => s.entry && !s.exit)}
            style={
              (Array.isArray(sessions["Planta 1"])
                ? sessions["Planta 1"]
                : []
              ).some((session) => session.entry)
                ? styles.pickerItemDisabled
                : styles.pickerItem
            }
          />

          <Picker.Item
            label={`Planta 2 ${
              (Array.isArray(sessions["Planta 2"])
                ? sessions["Planta 2"]
                : []
              ).some((s) => s.exit)
                ? "✓"
                : "⏳"
            }`}
            value="Planta 2"
            disabled={(Array.isArray(sessions["Planta 2"])
              ? sessions["Planta 2"]
              : []
            ).some((s) => s.entry && !s.exit)}
            style={
              (Array.isArray(sessions["Planta 2"])
                ? sessions["Planta 2"]
                : []
              ).some((session) => session.entry)
                ? styles.pickerItemDisabled
                : styles.pickerItem
            }
          />
        </Picker>
      </View>

      <View style={styles.imageContainer}>
        <Text style={styles.subtitle}>Última Entrada</Text>

        {loading && <ActivityIndicator size="large" color="#0000ff" />}

        {!loading && entryImage && (
          <View style={styles.imageWrapper}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setShowDelete(!showDelete)}
            >
              <Image
                source={{ uri: entryImage }}
                style={styles.image}
                resizeMode="cover"
                onLoadStart={() =>
                  console.log("🖼️ Cargando imagen de entrada...")
                }
                onLoad={() => console.log("✅ Imagen de entrada cargada")}
                onError={(e) => {
                  console.error(
                    "❌ Error cargando imagen:",
                    e.nativeEvent.error
                  );
                  // CORRECCIÓN: No resetear la imagen cuando hay un error
                }}
              />
            </TouchableOpacity>

            {showDelete && (
              <TouchableOpacity
                style={styles.trashButton}
                onPress={removeEntryImage}
              >
                <MaterialIcons name="delete" color="white" size={24} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {!loading && !entryImage && (
          <Text style={styles.placeholderText}>No hay imagen de entrada</Text>
        )}
      </View>

      <View style={styles.imageContainer}>
        <Text style={styles.subtitle}>Última Salida</Text>
        {loading && <ActivityIndicator size="large" color="#0000ff" />}
        {!loading && exitImage && (
          <Image
            source={{ uri: exitImage }}
            style={styles.image}
            resizeMode="cover"
            onLoadStart={() => console.log("🖼️ Cargando imagen de salida...")}
            onLoad={() => console.log("✅ Imagen de salida cargada")}
            onError={(e) => {
              console.error(
                "❌ Error cargando imagen de salida:",
                e.nativeEvent.error
              );
              // CORRECCIÓN: No resetear la imagen cuando hay un error
            }}
          />
        )}
        {!loading && !exitImage && (
          <Text style={styles.placeholderText}>No hay registro de salida</Text>
        )}
      </View>

      <View style={styles.buttonGroup}>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.entryButton]}
            onPress={() => registerAction(ACTION_ENTRY)}
          >
            <Text style={styles.buttonText}>📥 Registrar Entrada</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.exitButton]}
            onPress={() => registerAction(ACTION_EXIT)}
          >
            <Text style={styles.buttonText}>📤 Registrar Salida</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={goToCalcularHoras}
            style={[
              styles.button,
              styles.calculateButton,
              !calcularHorasHabilitado && styles.disabledButton, // ✅ SIN PARÉNTESIS
            ]}
            disabled={!calcularHorasHabilitado} // ✅ SIN PARÉNTESIS
          >
            <Text style={styles.buttonText}>🕒 Calcular Horas</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.reportButton]}
            onPress={() => navigation.navigate("Reporte")}
          >
            <Text style={styles.buttonText}>📊 Generar Reporte</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.exitButton]}
            onPress={cerrarJornada} // ✅ Correcto: Botón independiente
          >
            <Text style={styles.buttonText}>🔒 Cerrar Jornada</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Feedback siempre visible */}
      <View style={styles.feedbackBubble}>
        <Text style={styles.feedbackText}>
          {/* ==== CAMBIO CLAVE ==== */}
          {lastAction || "Registra tu primera entrada"}
          {/* ====================== */}
        </Text>
      </View>

      {/* Lista de registros mejorada */}
      <View style={styles.sessionsContainer}>
        {sessions[selectedPlant]?.map((session, index) => {
          const entryDate = normalizeDate(session.entry);
          const exitDate = normalizeDate(session.exit);

          return (
            <View
              key={`${selectedPlant}_${session.entry || index}`}
              style={styles.sessionCard}
            >
              {/* Encabezado */}
              <View style={styles.sessionHeader}>
                <Text style={styles.sessionNumber}>Registro #{index + 1}</Text>
                {!session.exit && (
                  <View style={styles.statusIndicator}>
                    <MaterialIcons
                      name="hourglass-empty"
                      size={14}
                      color="white"
                    />
                    <Text style={styles.statusText}>En progreso</Text>
                  </View>
                )}
              </View>

              {/* Entrada */}
              <View style={styles.timeRow}>
                <MaterialIcons name="login" size={16} color="#2ecc71" />
                <Text style={styles.timeText}>
                  {entryDate
                    ? formatColombianDateTime(entryDate)
                    : "--/--/-- --:--"}
                </Text>
                {/* ==== CAMBIO CLAVE ==== */}
                {session.entryImage && (
                  <Image
                    source={{ uri: session.entryImage }}
                    style={styles.miniThumbnail}
                    onError={(e) =>
                      console.error("Error en miniatura:", e.nativeEvent.error)
                    }
                  />
                )}
                {/* ====================== */}
              </View>

              {/* Salida */}
              <View style={styles.timeRow}>
                <MaterialIcons name="logout" size={16} color="#e74c3c" />
                <Text style={styles.timeText}>
                  {exitDate
                    ? formatColombianDateTime(exitDate)
                    : "--/--/-- --:--"}
                </Text>
                {/* ==== CAMBIO CLAVE ==== */}
                {session.exitImage && (
                  <Image
                    source={{ uri: session.exitImage }}
                    style={styles.miniThumbnail}
                    onError={(e) =>
                      console.error(
                        "Error en miniatura de salida:",
                        e.nativeEvent.error
                      )
                    }
                  />
                )}
                {/* ====================== */}
              </View>

              {/* Duración calculada (sin cambios) */}
              {exitDate && (
                <View style={styles.durationRow}>
                  <MaterialIcons name="timer" size={16} color="#3498db" />
                  <Text style={styles.durationText}>
                    {calculateDuration(entryDate, exitDate)}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <StatusBar style="auto" />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  // CONTAINER & LAYOUT
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: "#f8fbfd", // Slightly cooler background for better contrast
  },

  // TYPOGRAPHY
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 24,
    textAlign: "center",
    color: "#1c2b46",
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: "600",
    marginVertical: 12,
    color: "#455571",
    letterSpacing: 0.2,
  },

  // PICKER STYLES
  pickerContainer: {
    borderRadius: 12,
    marginBottom: 20,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  picker: {
    height: 56,
    width: "100%",
    backgroundColor: "#2563eb", // Updated to a more vibrant blue
    color: "#fff",
    borderRadius: 12,
  },
  pickerItem: {
    color: "#fff",
    backgroundColor: "#1e4ed8", // Darker blue for picker items
  },
  pickerItemDisabled: {
    color: "rgba(255, 255, 255, 0.6)",
    backgroundColor: "#1e4ed8",
  },

  // IMAGE CONTAINERS
  imageContainer: {
    marginVertical: 16,
    alignItems: "center",
  },
  imageWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    overflow: "hidden", // Ensure shadows don't get clipped
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
  },
  image: {
    width: 280, // Slightly wider for better visibility
    height: 220,
    borderRadius: 16,
    borderWidth: 0, // Remove border as we're using shadows
  },
  trashButton: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(239, 68, 68, 0.9)", // Vibrant red with opacity
    padding: 12,
    borderRadius: 30, // More rounded for modern look
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },

  // BUTTON GROUP
  buttonGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginVertical: 20,
    gap: 12, // Using gap for consistent spacing
  },
  buttonContainer: {
    flex: 1,
    minWidth: "48%",
    marginVertical: 6,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 5,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
    flexDirection: "row", // Allow for icon + text
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: 0.5,
  },
  entryButton: {
    backgroundColor: "#059669", // Elegant green
    borderRadius: 12,
  },
  exitButton: {
    backgroundColor: "#e11d48", // Rich red
    borderRadius: 12,
  },
  calculateButton: {
    backgroundColor: "#2563eb", // Vibrant blue
    borderRadius: 12,
  },
  reportButton: {
    backgroundColor: "#7c3aed", // Modern purple
    borderRadius: 12,
  },
  disabledButton: {
    backgroundColor: "#94a3b8", // Subtle gray
    opacity: 0.7,
    elevation: 1, // Reduced elevation for disabled state
  },

  // TEXT STATES
  placeholderText: {
    fontSize: 15,
    color: "#64748b",
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 30,
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    overflow: "hidden",
    width: 280, // Match image width
  },

  // FEEDBACK BUBBLE
  feedbackBubble: {
    backgroundColor: "#eff6ff", // Light blue background
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    marginBottom: 8,
    alignItems: "flex-start", // Left align for better readability
    borderLeftWidth: 4,
    borderLeftColor: "#3b82f6", // Accent border
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  feedbackText: {
    fontSize: 15,
    lineHeight: 22,
    color: "#1e40af", // Darker blue for better contrast
  },

  // SESSIONS CONTAINER
  sessionsContainer: {
    marginTop: 28,
    width: "100%",
  },

  // SESSION CARDS
  sessionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    marginVertical: 10,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    borderLeftWidth: 5,
    borderLeftColor: "#3b82f6",
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center", // Better vertical alignment
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 12,
  },
  sessionNumber: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e40af",
  },
  statusIndicator: {
    backgroundColor: "#f97316", // Orange for in progress
    borderRadius: 30, // Fully rounded for tag appearance
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row", // For icon + text
    alignItems: "center",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
    color: "white",
    marginLeft: 5,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10, // Using gap for even spacing
    marginVertical: 8,
    backgroundColor: "#f8fafc", // Light background for better separation
    padding: 12,
    borderRadius: 8,
  },
  timeText: {
    fontSize: 15,
    color: "#334155",
    flex: 1,
    letterSpacing: 0.2,
  },
  miniThumbnail: {
    width: 45,
    height: 45,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    backgroundColor: "#f0f9ff", // Light blue background
    padding: 12,
    borderRadius: 8,
  },
  durationText: {
    fontSize: 15,
    color: "#0284c7", // Brighter blue for emphasis
    fontWeight: "600",
  },

  // SECTION HEADERS
  sectionHeader: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e40af",
    marginTop: 24,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },

  // EMPTY STATES
  emptyStateContainer: {
    alignItems: "center",
    padding: 40,
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    marginVertical: 20,
  },
  emptyStateText: {
    fontSize: 16,
    color: "#64748b",
    textAlign: "center",
    marginTop: 12,
  },
});

export default RegistroHora;
