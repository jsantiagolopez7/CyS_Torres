import { MaterialIcons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
// Eliminamos la importación de onAuthStateChanged
import { doc, getDoc, setDoc } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  LogBox,
  Platform,
} from "react-native";
// Modificamos la importación de Firebase
import AsyncStorage from "@react-native-async-storage/async-storage";
import { completeFirebaseInit, db } from "./database/firebase";
import { loadData, removeData, saveData } from "./services/storageService";

// Import all screens (mantiene igual)
import AdminScreen from "./screens/AdminScreen";
import CalcularHorasScreen from "./screens/CalcularHorasScreen";
import CrearUsuarios from "./screens/CrearUsuarios";
import DiagnosticoFirebase from "./screens/DiagnosticoFirebase";
import Home from "./screens/Home";
import Jornadas from "./screens/Jornadas";
import ListaUsuarios from "./screens/ListaUsuarios";
import Login from "./screens/Login";
import Perfil from "./screens/Perfil";
import RegistroHora from "./screens/RegistroHora";
import RegistrosUsuarios from "./screens/RegistrosUsuarios";
import Reporte from "./screens/Reporte";
import ReporteAdmin from "./screens/ReporteAdmin";

// API URL base
const API_BASE_URL = "http://localhost:5250"; // Cambia esto según tu entorno

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Navigation components for different roles (mantiene igual)
function UserBottomTabs() {
  // Sin cambios
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#007AFF",
        tabBarInactiveTintColor: "gray",
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="RegistroHora"
        component={RegistroHora}
        options={{
          tabBarLabel: "Registro",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="schedule" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Jornadas"
        component={Jornadas}
        options={{
          tabBarLabel: "Jornada",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="calendar-today" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Perfil"
        component={Perfil}
        options={{
          tabBarLabel: "Perfil",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ListaUsuarios"
        component={ListaUsuarios}
        options={{
          tabBarLabel: "ListaUsuarios",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function AdminBottomTabs() {
  // Sin cambios
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#007AFF",
        tabBarInactiveTintColor: "gray",
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Perfil"
        component={Perfil}
        options={{
          tabBarLabel: "Perfil",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="RegistrosUsuarios"
        component={RegistrosUsuarios}
        options={{
          tabBarLabel: "Registros",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ReporteAdmin"
        component={ReporteAdmin}
        options={{
          title: "Reportes",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="bar-chart" size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="AdminScreen"
        component={AdminScreen}
        options={{
          tabBarLabel: "Admin",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons
              name="admin-panel-settings"
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  // Application states (mantiene igual)
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [isConnected, setIsConnected] = useState(true);
  const [firebaseInitComplete, setFirebaseInitComplete] = useState(false);
  const navigationRef = useRef();

  // Referencias (mantiene igual)
  const isMountedRef = useRef(true);
  const authTimeoutRef = useRef(null);
  const networkListenerRef = useRef(null);

  // Manejo de errores de imagen (mantiene igual)
  Image.onError = (error) => {
    console.log("‚ùì Error loading image:", error.nativeEvent.error);
  };

  // Ignorar logs específicos (mantiene igual)
  LogBox.ignoreLogs([
    "Failed to load image",
    "Setting a timer",
    "AsyncStorage has been extracted",
    "Can't perform a React state update on an unmounted component",
  ]);

  // Configuración de canales de notificación para Android (mantiene igual)
  useEffect(() => {
    if (Platform.OS === "android") {
      const setupNotificationChannels = async () => {
        await Notifications.setNotificationChannelAsync("entrada_usuarios", {
          name: "Entradas de usuarios",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#FF231F7C",
          sound: "notification_sound",
          description: "Notificaciones cuando un usuario registra entrada",
        });

        await Notifications.setNotificationChannelAsync("cierre_jornadas", {
          name: "Cierre de jornadas",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#4CAF50",
          sound: "notification_sound",
          description: "Notificaciones cuando un usuario cierra su jornada",
        });
      };

      setupNotificationChannels();
    }
  }, []);

  // Monitor de conectividad (mantiene igual)
  useEffect(() => {
    // Subscribe to connectivity changes
    networkListenerRef.current = NetInfo.addEventListener((state) => {
      const isConnectedNow =
        state.isConnected && state.isInternetReachable !== false;

      // Only update global state if changed to avoid unnecessary renders
      if (isConnectedNow !== isConnected && isMountedRef.current) {
        console.log(
          `${
            isConnectedNow ? "üåê Connection restored" : "üìµ Connection lost"
          }`
        );
        setIsConnected(isConnectedNow);

        // Si la conexión se restaura y hay un usuario autenticado, verificar documento
        if (isConnectedNow && user && isMountedRef.current) {
          verifyUserDocument(user.uid);
        }
      }
    });

    // Check initial connectivity state
    NetInfo.fetch().then((state) => {
      if (isMountedRef.current) {
        const initialConnected =
          state.isConnected && state.isInternetReachable !== false;
        setIsConnected(initialConnected);
      }
    });

    return () => {
      if (networkListenerRef.current) {
        networkListenerRef.current(); // Unsubscribe listener
        networkListenerRef.current = null;
      }
    };
  }, [isConnected, user]);

  // Completar la inicialización de Firebase (mantiene igual)
  useEffect(() => {
    const initFirebase = async () => {
      try {
        // Intentar inicializar Firebase
        const success = await completeFirebaseInit();
        if (isMountedRef.current) {
          setFirebaseInitComplete(success);
          console.log(
            `üî• Firebase initialization ${success ? "completed" : "failed"}`
          );
        }
      } catch (error) {
        console.error("‚ùå Error in Firebase initialization:", error);
        if (isMountedRef.current) {
          setFirebaseInitComplete(false);
        }
      }
    };

    initFirebase();
  }, []);

  // Cargar sesión persistente al inicio (mantiene igual)
  useEffect(() => {
    const loadPersistentSession = async () => {
      try {
        const savedUser = await loadData("userSession");
        const savedRole = await loadData("userRole");
        // Verificar el token JWT
        const token = await AsyncStorage.getItem("token");

        // Solo considerar al usuario autenticado si tiene un token
        if (savedUser && token && isMountedRef.current) {
          console.log("üîÑ Restoring session from local storage");
          setUser(savedUser);

          if (savedRole && isMountedRef.current) {
            setRole(savedRole);
            console.log(`üë®‚Äçüíº Role restored: ${savedRole}`);
          } else {
            console.log("‚ö†Ô∏è No saved role");
          }
        } else {
          console.log("üôÖ No saved session or token expired");
          // Limpiar datos si no hay token
          if (!token) {
            await removeData("userSession");
            await removeData("userRole");
          }
        }
      } catch (error) {
        console.error("‚ùå Error loading persistent session:", error);
      } finally {
        // Only change loading when we are certain
        // that the session restoration process is completed
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    loadPersistentSession();

    // Clean up when unmounting component
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Improved function to verify user documents (mantiene igual)
  const verifyUserDocument = async (userId) => {
    if (!userId || !db) {
      console.error("‚ùå UserID or Firestore not available");
      return null;
    }

    try {
      console.log("üîÑ Verifying document for user:", userId);
      const userRef = doc(db, "users", userId);

      // Implement retry system
      let attempts = 0;
      const MAX_ATTEMPTS = 3;

      while (attempts < MAX_ATTEMPTS) {
        try {
          const userDoc = await getDoc(userRef);

          if (userDoc.exists()) {
            console.log("‚úÖ User document exists");
            return userDoc.data();
          }

          // Create new document if it doesn't exist
          console.log("‚ö†Ô∏è Document doesn't exist, creating it now");
          const userData = {
            uid: userId,
            role: "user",
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            preferences: {},
            fcmToken: null,
          };

          await setDoc(userRef, userData);
          console.log("‚úÖ User document created successfully");
          return userData;
        } catch (error) {
          attempts++;
          console.warn(`‚ö†Ô∏è Error in attempt ${attempts}:`, error.message);

          if (attempts >= MAX_ATTEMPTS) throw error;

          // Wait with exponential backoff before retrying
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * Math.pow(2, attempts - 1))
          );
        }
      }
    } catch (error) {
      console.error("‚ùå Error verifying/creating document:", error);
      return null;
    }
  };

  // Nueva función para verificar la validez del token JWT
  const verifyToken = async () => {
    try {
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        if (isMountedRef.current) {
          setUser(null);
          setRole(null);
        }
        await Promise.all([removeData("userSession"), removeData("userRole")]);
        return;
      }

      // Opcional: verificar el token con el backend
      const response = await fetch(`${API_BASE_URL}/auth/verify-token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // Token inválido, borrar sesión
        if (isMountedRef.current) {
          setUser(null);
          setRole(null);
        }
        await Promise.all([
          removeData("userSession"),
          removeData("userRole"),
          AsyncStorage.removeItem("token"),
        ]);
      }
    } catch (error) {
      console.error("Error verificando token:", error);
      // En caso de error, mantener la sesión para evitar desconexiones por problemas de red
    }
  };

  // Verificar token JWT periódicamente
  useEffect(() => {
    // Verificar token al inicio
    if (firebaseInitComplete) {
      verifyToken();
    }

    // Verificar periódicamente (cada 15 min)
    const tokenInterval = setInterval(() => {
      if (isMountedRef.current) {
        verifyToken();
      }
    }, 15 * 60 * 1000);

    return () => clearInterval(tokenInterval);
  }, [firebaseInitComplete]);

  // Establecer usuario cuando se inicie sesión a través de la API
  useEffect(() => {
    const checkApiLogin = async () => {
      try {
        const apiUserData = await AsyncStorage.getItem("apiUserData");
        const token = await AsyncStorage.getItem("token");

        if (apiUserData && token && isMountedRef.current) {
          const userData = JSON.parse(apiUserData);

          // Actualizar estado de usuario
          setUser({
            uid: userData.id,
            email: userData.email,
            lastLogin: new Date().toISOString(),
          });

          // Actualizar rol
          setRole(userData.role || "user");

          // Guardar en storage
          await saveData("userSession", {
            uid: userData.id,
            email: userData.email,
            lastLogin: new Date().toISOString(),
          });
          await saveData("userRole", userData.role || "user");

          // Verificar documento en Firestore
          if (isConnected) {
            await verifyUserDocument(userData.id);
          }
        }
      } catch (error) {
        console.error("Error checking API login:", error);
      }
    };

    if (firebaseInitComplete) {
      checkApiLogin();
    }
  }, [firebaseInitComplete, isConnected]);

  // Notification setup (mantiene igual)
  useEffect(() => {
    // More robust notification handler with error handling
    const setupNotifications = async () => {
      try {
        // Configure handler for notifications
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        // Request permissions on iOS
        if (Platform.OS === "ios") {
          const { status } = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          });

          console.log(`üì± iOS Notification permissions: ${status}`);
        }

        // Handle foreground notifications
        const foregroundSubscription =
          Notifications.addNotificationReceivedListener((notification) => {
            console.log("Notification received in foreground:", notification);
          });

        // Handle tap notifications
        const responseSubscription =
          Notifications.addNotificationResponseReceivedListener((response) => {
            if (!isMountedRef.current) return;

            try {
              const { notification } = response;
              const data = notification.request.content.data;

              // Navigate based on notification type
              if (data && data.tipo === "cierre_jornada") {
                // If user is already authenticated and is admin
                if (user && role === "admin") {
                  // Navigate with delay to ensure navigation is ready
                  setTimeout(() => {
                    navigationRef.current?.navigate("RegistrosUsuarios", {
                      highlightedJornadaId: data.jornadaId,
                      userId: data.userId,
                      fecha: data.fecha,
                    });
                  }, 500);
                } else {
                  // Save for use after login
                  saveData("pendingNotification", {
                    screen: "RegistrosUsuarios",
                    params: {
                      highlightedJornadaId: data.jornadaId,
                      userId: data.userId,
                      fecha: data.fecha,
                    },
                  });
                }
              } else if (data && data.tipo === "entrada") {
                if (user && role === "admin") {
                  setTimeout(() => {
                    navigationRef.current?.navigate("RegistrosUsuarios", {
                      filtroUsuarioId: data.userId,
                      planta: data.planta,
                    });
                  }, 500);
                }
              }
            } catch (error) {
              console.error(
                "‚ùå Error processing notification response:",
                error
              );
            }
          });

        // Register notification token
        const tokenSubscription = Notifications.addPushTokenListener(
          async (token) => {
            try {
              console.log("Notification token:", token);
              if (user) {
                await setDoc(
                  doc(db, "users", user.uid),
                  { fcmToken: token.data },
                  { merge: true }
                );
              }
            } catch (error) {
              console.error("‚ùå Error saving FCM token:", error);
            }
          }
        );

        // Check if app was opened from a notification
        const checkInitialNotification = async () => {
          try {
            const response =
              await Notifications.getLastNotificationResponseAsync();
            if (response) {
              const data = response.notification.request.content.data;
              // Save for use after authentication
              if (data) {
                await saveData("pendingNotification", {
                  screen:
                    data.tipo === "cierre_jornada"
                      ? "RegistrosUsuarios"
                      : "RegistrosUsuarios",
                  params:
                    data.tipo === "cierre_jornada"
                      ? {
                          highlightedJornadaId: data.jornadaId,
                          userId: data.userId,
                          fecha: data.fecha,
                        }
                      : { filtroUsuarioId: data.userId, planta: data.planta },
                });
              }
            }
          } catch (error) {
            console.error("‚ùå Error checking initial notification:", error);
          }
        };

        checkInitialNotification();

        // Clean up subscriptions when unmounting
        return () => {
          try {
            foregroundSubscription.remove();
            responseSubscription.remove();
            tokenSubscription.remove();
          } catch (error) {
            console.error("‚ùå Error cleaning up subscriptions:", error);
          }
        };
      } catch (error) {
        console.error("‚ùå Error setting up notifications:", error);
      }
    };

    setupNotifications();
  }, [role, user]);

  // Also check for pending notifications after login (mantiene igual con pequeño ajuste)
  useEffect(() => {
    const checkPendingNotifications = async () => {
      if (!isMountedRef.current) return;

      try {
        if (user && role === "admin") {
          const pendingNotification = await loadData("pendingNotification");
          if (pendingNotification && navigationRef.current) {
            setTimeout(() => {
              navigationRef.current.navigate(
                pendingNotification.screen,
                pendingNotification.params
              );
              removeData("pendingNotification");
            }, 1000); // Small delay to ensure navigation is ready
          }
        }
      } catch (error) {
        console.error("‚ùå Error checking pending notifications:", error);
      }
    };

    checkPendingNotifications();
  }, [user, role]);

  // OTA update function (mantiene igual)
  const checkForUpdates = async () => {
    try {
      // Only check if there is a connection
      if (!isConnected) {
        console.log("üìµ No connection, skipping update check");
        return;
      }

      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        Alert.alert("New update", "App needs to restart", [
          {
            text: "OK",
            onPress: async () => {
              await Updates.fetchUpdateAsync();
              await Updates.reloadAsync();
            },
          },
        ]);
      }
    } catch (error) {
      console.error("Error checking for updates", error);
    }
  };

  useEffect(() => {
    if (isConnected) {
      checkForUpdates();
    }

    // Clean up on unmount
    return () => {
      isMountedRef.current = false;
    };
  }, [isConnected]);

  // Show loading indicator while initializing
  if (isLoading || !firebaseInitComplete) {
    return (
      <ActivityIndicator size="large" style={{ flex: 1 }} color="#0066cc" />
    );
  }

  // Show connection indicator in development
  if (__DEV__ && !isConnected) {
    console.log("üõ†Ô∏è Offline Mode - Using local data");
  }

  // Navigation structure
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // Authentication screens
          <>
            <Stack.Screen name="Home" component={Home} />
            <Stack.Screen name="Login" component={Login} />
            <Stack.Screen name="CrearUsuarios" component={CrearUsuarios} />
          </>
        ) : (
          // Tab navigators based on role
          <>
            {role === "admin" ? (
              <Stack.Screen
                name="AdminTabs"
                component={AdminBottomTabs}
                options={{ headerShown: false }}
              />
            ) : (
              <Stack.Screen
                name="UserTabs"
                component={UserBottomTabs}
                options={{ headerShown: false }}
              />
            )}
          </>
        )}

        {/* Individual screens for internal navigation */}
        <Stack.Screen name="Perfil" component={Perfil} />
        <Stack.Screen name="Reporte" component={Reporte} />
        <Stack.Screen name="CalcularHoras" component={CalcularHorasScreen} />
        <Stack.Screen name="ListaUsuarios" component={ListaUsuarios} />
        <Stack.Screen name="AdminScreen" component={AdminScreen} />
        <Stack.Screen name="RegistrosUsuarios" component={RegistrosUsuarios} />
        <Stack.Screen name="RegistroHora" component={RegistroHora} />
        <Stack.Screen name="Jornadas" component={Jornadas} />
        <Stack.Screen
          name="DiagnosticoFirebase"
          component={DiagnosticoFirebase}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
