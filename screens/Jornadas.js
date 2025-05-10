import { FontAwesome5 } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth } from "../database/firebase";

const Jornadas = () => {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  
  // Almacenamiento de datos por planta
  const [plantData, setPlantData] = useState({
    "Planta 1": {
      sessions: [],
      entryImage: null,
      exitImage: null,
      hasActiveSession: false,
    },
    "Planta 2": {
      sessions: [],
      entryImage: null,
      exitImage: null,
      hasActiveSession: false,
    }
  });
  
  // Estadísticas de resumen
  const [stats, setStats] = useState({
    totalHours: 0,
    totalMinutes: 0,
    plant1Hours: 0,
    plant1Minutes: 0,
    plant2Hours: 0,
    plant2Minutes: 0,
  });

  // Cargar datos desde el almacenamiento
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        setError("Usuario no autenticado");
        setLoading(false);
        return;
      }
      
      // Cargar datos de sesiones
      const sessionsData = await AsyncStorage.getItem(`sessions_${userId}`);
      let sessions = { "Planta 1": [], "Planta 2": [] };
      
      if (sessionsData) {
        try {
          const parsed = JSON.parse(sessionsData);
          if (parsed && typeof parsed === "object") {
            sessions = {
              "Planta 1": Array.isArray(parsed["Planta 1"]) ? parsed["Planta 1"] : [],
              "Planta 2": Array.isArray(parsed["Planta 2"]) ? parsed["Planta 2"] : [],
            };
          }
        } catch (e) {
          console.error("Error al analizar datos de sesiones:", e);
        }
      }
      
      // Cargar imágenes de entrada y salida para ambas plantas
      const updatedPlantData = { ...plantData };
      
      // Verificar sesiones activas y obtener las imágenes más recientes
      for (const plantName of ["Planta 1", "Planta 2"]) {
        const plantSessions = sessions[plantName] || [];
        const hasActiveSession = plantSessions.some(session => session.entry && !session.exit);
        
        updatedPlantData[plantName] = {
          sessions: plantSessions,
          hasActiveSession,
          entryImage: null,
          exitImage: null,
        };
        
        // REQUISITO CLAVE: Obtener todas las claves en el almacenamiento
        const allKeys = await AsyncStorage.getAllKeys();
        
        // Buscar claves de imágenes de entrada para esta planta
        const entryKeys = allKeys.filter(
          key => key.startsWith(`entryImage_${userId}_${plantName}_`)
        );
        
        if (entryKeys.length > 0) {
          // Ordenar por fecha (más reciente primero)
          entryKeys.sort().reverse();
          
          for (const entryKey of entryKeys) {
            const entryDataJson = await AsyncStorage.getItem(entryKey);
            if (entryDataJson) {
              try {
                const entryData = JSON.parse(entryDataJson);
                if (entryData?.imageUrl) {
                  updatedPlantData[plantName].entryImage = entryData.imageUrl;
                  console.log(`✅ Imagen de entrada cargada para ${plantName}: ${entryData.imageUrl}`);
                  break; // Usar la primera imagen válida que encontremos
                }
              } catch (e) {
                console.error(`Error al analizar datos de entrada para ${plantName}:`, e);
              }
            }
          }
        }
        
        // Verificar imagen de salida para hoy
        const today = new Date().toISOString().split('T')[0];
        const exitKey = `exitImage_${userId}_${plantName}_${today}`;
        const exitDataJson = await AsyncStorage.getItem(exitKey);
        
        if (exitDataJson) {
          try {
            const exitData = JSON.parse(exitDataJson);
            if (exitData?.imageUrl) {
              updatedPlantData[plantName].exitImage = exitData.imageUrl;
              console.log(`✅ Imagen de salida cargada para ${plantName}: ${exitData.imageUrl}`);
            }
          } catch (e) {
            console.error(`Error al analizar datos de salida para ${plantName}:`, e);
          }
        }
      }
      
      setPlantData(updatedPlantData);
      
      // Calcular estadísticas
      calculateStats(sessions);
      
    } catch (error) {
      console.error("Error al cargar datos:", error);
      setError("Error cargando los datos. Por favor intente de nuevo.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  
  // Calcular horas totales y otras estadísticas
  const calculateStats = useCallback((sessions) => {
    let plant1Hours = 0;
    let plant1Minutes = 0;
    let plant2Hours = 0;
    let plant2Minutes = 0;
    
    // Calcular para Planta 1
    sessions["Planta 1"]?.forEach(session => {
      if (session.entry && session.exit) {
        try {
          const entryDate = new Date(session.entry);
          const exitDate = new Date(session.exit);
          const diffMs = exitDate - entryDate;
          plant1Hours += Math.floor(diffMs / (1000 * 60 * 60));
          plant1Minutes += Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        } catch (e) {
          console.warn("Error al calcular duración para sesión de Planta 1:", e);
        }
      }
    });
    
    // Calcular para Planta 2
    sessions["Planta 2"]?.forEach(session => {
      if (session.entry && session.exit) {
        try {
          const entryDate = new Date(session.entry);
          const exitDate = new Date(session.exit);
          const diffMs = exitDate - entryDate;
          plant2Hours += Math.floor(diffMs / (1000 * 60 * 60));
          plant2Minutes += Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        } catch (e) {
          console.warn("Error al calcular duración para sesión de Planta 2:", e);
        }
      }
    });
    
    // Convertir minutos excesivos a horas
    plant1Hours += Math.floor(plant1Minutes / 60);
    plant1Minutes = plant1Minutes % 60;
    
    plant2Hours += Math.floor(plant2Minutes / 60);
    plant2Minutes = plant2Minutes % 60;
    
    // Horas y minutos totales
    const totalHours = plant1Hours + plant2Hours;
    const totalMinutes = plant1Minutes + plant2Minutes;
    
    // Actualizar estadísticas
    setStats({
      plant1Hours,
      plant1Minutes,
      plant2Hours,
      plant2Minutes,
      totalHours: totalHours + Math.floor(totalMinutes / 60),
      totalMinutes: totalMinutes % 60
    });
    
  }, []);
  
  // Carga de datos inicial
  useEffect(() => {
    if (isFocused) {
      loadData();
    }
  }, [isFocused, loadData]);
  
  // Función para formatear fechas
  const formatDateTime = (dateString) => {
    if (!dateString) return "--/--/-- --:--";
    try {
      const date = parseISO(dateString);
      return format(date, "dd/MM/yyyy HH:mm", { locale: es });
    } catch (error) {
      console.warn("Error al formatear fecha:", error);
      return "--/--/-- --:--";
    }
  };
  
  // Calcular duración entre dos fechas
  const calculateDuration = (start, end) => {
    if (!start || !end) return "En progreso";
    try {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const diffMs = endDate - startDate;
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${diffHours}h ${diffMinutes}m`;
    } catch (error) {
      console.warn("Error al calcular duración:", error);
      return "Error";
    }
  };
  
  // Manejador de pull-to-refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);
  
  // Componente de sección de planta
  const PlantSection = useCallback(({ plantName }) => {
    const plant = plantData[plantName];
    
    if (!plant) return null;
    
    return (
      <View style={styles.plantContainer}>
        <View style={styles.plantHeader}>
          <Text style={styles.plantTitle}>{plantName}</Text>
          <View style={[
            styles.statusBadge, 
            plant.hasActiveSession ? styles.activeStatus : styles.completedStatus
          ]}>
            <Text style={styles.statusText}>
              {plant.hasActiveSession ? "En progreso" : "Completado"}
            </Text>
          </View>
        </View>
        
        <View style={styles.imagesContainer}>
          {/* Imagen de Entrada */}
          <View style={styles.imageColumn}>
            <Text style={styles.imageLabel}>Entrada</Text>
            <View style={styles.imageWrapper}>
              {plant.entryImage ? (
                <Image 
                  source={{ uri: plant.entryImage }}
                  style={styles.image}
                  onError={() => console.warn(`Error cargando imagen de entrada de ${plantName}`)}
                  defaultSource={require('../assets/icon.png')}
                />
              ) : (
                <View style={styles.noImageContainer}>
                  <FontAwesome5 name="image" size={32} color="#ccc" />
                  <Text style={styles.noImageText}>No registrada</Text>
                </View>
              )}
            </View>
          </View>
          
          {/* Imagen de Salida */}
          <View style={styles.imageColumn}>
            <Text style={styles.imageLabel}>Salida</Text>
            <View style={styles.imageWrapper}>
              {plant.exitImage ? (
                <Image 
                  source={{ uri: plant.exitImage }}
                  style={styles.image}
                  onError={() => console.warn(`Error cargando imagen de salida de ${plantName}`)}
                  defaultSource={require('../assets/icon.png')}
                />
              ) : (
                <View style={styles.noImageContainer}>
                  <FontAwesome5 name="image" size={32} color="#ccc" />
                  <Text style={styles.noImageText}>No registrada</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        
        {/* Lista de sesiones */}
        <Text style={styles.sessionsTitle}>Registros detallados:</Text>
        {plant.sessions.length > 0 ? (
          plant.sessions.map((session, index) => (
            <SessionItem 
              key={`${plantName}-session-${index}`}
              session={session} 
              index={index} 
            />
          ))
        ) : (
          <Text style={styles.noSessionsText}>No hay registros para esta planta</Text>
        )}
      </View>
    );
  }, [plantData]);
  
  // Componente de ítem de sesión
  const SessionItem = useCallback(({ session, index }) => {
    return (
      <View style={styles.sessionCard}>
        <Text style={styles.sessionNumber}>Registro #{index + 1}</Text>
        
        <View style={styles.timeRow}>
          <FontAwesome5 name="sign-in-alt" size={16} color="#2ecc71" />
          <Text style={styles.timeLabel}>Entrada:</Text>
          <Text style={styles.timeValue}>
            {session.entry ? formatDateTime(session.entry) : "--/--/-- --:--"}
          </Text>
        </View>
        
        <View style={styles.timeRow}>
          <FontAwesome5 name="sign-out-alt" size={16} color="#e74c3c" />
          <Text style={styles.timeLabel}>Salida:</Text>
          <Text style={styles.timeValue}>
            {session.exit ? formatDateTime(session.exit) : "--/--/-- --:--"}
          </Text>
        </View>
        
        {session.entry && session.exit && (
          <View style={styles.durationRow}>
            <FontAwesome5 name="clock" size={16} color="#3498db" />
            <Text style={styles.durationLabel}>Duración:</Text>
            <Text style={styles.durationValue}>{calculateDuration(session.entry, session.exit)}</Text>
          </View>
        )}
        
        {!session.exit && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>Pendiente de salida</Text>
          </View>
        )}
      </View>
    );
  }, [formatDateTime, calculateDuration]);
  
  // Estado de carga
  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Cargando jornadas...</Text>
      </View>
    );
  }
  
  // Estado de error
  if (error) {
    return (
      <View style={styles.centerContainer}>
        <FontAwesome5 name="exclamation-circle" size={50} color="#e74c3c" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => loadData()}
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }
  
  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.header}>Mis Jornadas</Text>
      
      {/* Tarjeta de resumen */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Resumen de horas</Text>
        <Text style={styles.totalHours}>
          {stats.totalHours}h {stats.totalMinutes}m
        </Text>
        
        <View style={styles.plantStats}>
          <View style={styles.plantStat}>
            <Text style={styles.plantStatLabel}>Planta 1</Text>
            <Text style={styles.plantStatValue}>
              {stats.plant1Hours}h {stats.plant1Minutes}m
            </Text>
          </View>
          
          <View style={styles.plantStat}>
            <Text style={styles.plantStatLabel}>Planta 2</Text>
            <Text style={styles.plantStatValue}>
              {stats.plant2Hours}h {stats.plant2Minutes}m
            </Text>
          </View>
        </View>
      </View>
      
      {/* Sección Planta 1 */}
      <PlantSection plantName="Planta 1" />
      
      {/* Sección Planta 2 */}
      <PlantSection plantName="Planta 2" />
      
      {/* Botones de acción */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate("CalcularHoras")}
        >
          <Text style={styles.buttonText}>Ver Detalle de Horas</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.navigate("RegistroHora")}
        >
          <Text style={styles.buttonText}>Volver al Registro</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#007AFF",
  },
  errorText: {
    marginTop: 10,
    marginBottom: 20,
    fontSize: 16,
    color: "#e74c3c",
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 16,
    textAlign: "center",
  },
  summaryCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  summaryTitle: {
    fontSize: 16,
    color: "#7f8c8d",
    marginBottom: 8,
  },
  totalHours: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#3498db",
    marginBottom: 12,
  },
  plantStats: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#ecf0f1",
    paddingTop: 12,
  },
  plantStat: {
    flex: 1,
  },
  plantStatLabel: {
    fontSize: 14,
    color: "#7f8c8d",
    marginBottom: 4,
  },
  plantStatValue: {
    fontSize: 18,
    fontWeight: "600",
    color: "#2c3e50",
  },
  plantContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  plantHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ecf0f1",
    paddingBottom: 12,
  },
  plantTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  activeStatus: {
    backgroundColor: "#3498db",
  },
  completedStatus: {
    backgroundColor: "#27ae60",
  },
  statusText: {
    fontSize: 12,
    color: "white",
    fontWeight: "600",
  },
  imagesContainer: {
    flexDirection: "row",
    marginBottom: 16,
  },
  imageColumn: {
    flex: 1,
    alignItems: "center",
  },
  imageLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#34495e",
    marginBottom: 8,
  },
  imageWrapper: {
    width: "90%",
    aspectRatio: 1,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ecf0f1",
  },
  image: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  noImageContainer: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },
  noImageText: {
    marginTop: 8,
    color: "#95a5a6",
    fontSize: 14,
    fontStyle: "italic",
  },
  sessionsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2c3e50",
    marginVertical: 12,
  },
  noSessionsText: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#95a5a6",
    textAlign: "center",
    marginVertical: 16,
  },
  sessionCard: {
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  sessionNumber: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 8,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  timeLabel: {
    fontSize: 14,
    color: "#7f8c8d",
    marginLeft: 8,
    marginRight: 4,
    width: 55,
  },
  timeValue: {
    fontSize: 14,
    color: "#2c3e50",
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#ecf0f1",
  },
  durationLabel: {
    fontSize: 14,
    color: "#7f8c8d",
    fontWeight: "600",
    marginLeft: 8,
    marginRight: 4,
    width: 55,
  },
  durationValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#3498db",
  },
  pendingBadge: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#f39c12",
  },
  pendingText: {
    fontSize: 12,
    color: "white",
    fontWeight: "600",
  },
  actionButtons: {
    marginVertical: 16,
  },
  button: {
    backgroundColor: "#3498db",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: "#7f8c8d",
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default Jornadas;

