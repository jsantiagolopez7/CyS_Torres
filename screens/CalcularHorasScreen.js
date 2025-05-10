import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { auth } from "../database/firebase"; // 📌 Importamos Firebase
import { calculateTotalHours } from "../utils/CalcularHoras"; // 📌 Importamos la función de cálculo

const CalcularHorasScreen = () => {
  const [sessions, setSessions] = useState({});

  // 🔹 Cargar sesiones del usuario autenticado desde AsyncStorage
  useEffect(() => {
    const cargarSesionesUsuario = async () => {
      if (!auth.currentUser) return;

      const userId = auth.currentUser.uid;
      console.log(`🟢 Intentando cargar sesiones para el usuario: ${userId}`);

      const storedSessions = await AsyncStorage.getItem(`sessions_${userId}`);
      console.log("📂 Datos crudos obtenidos de AsyncStorage:", storedSessions);

      if (storedSessions) {
        try {
          const parsedSessions = JSON.parse(storedSessions);
          console.log("✅ Sesiones parseadas correctamente:", parsedSessions);

          const sanitizeSessions = (records) =>
            (Array.isArray(records) ? records : []).filter((session) =>
              session.entry && session.exit
                ? !isNaN(new Date(session.entry).getTime()) &&
                  !isNaN(new Date(session.exit).getTime())
                : true
            );

          setSessions({
            "Planta 1": sanitizeSessions(parsedSessions["Planta 1"]),
            "Planta 2": sanitizeSessions(parsedSessions["Planta 2"]),
          });

          console.log("📌 Sesiones actualizadas en el estado:", {
            "Planta 1": sanitizeSessions(parsedSessions["Planta 1"]),
            "Planta 2": sanitizeSessions(parsedSessions["Planta 2"]),
          });
        } catch (error) {
          console.error(
            "❌ Error al parsear sesiones desde AsyncStorage:",
            error
          );
          await AsyncStorage.removeItem(`sessions_${userId}`);
          setSessions({ "Planta 1": [], "Planta 2": [] });
        }
      } else {
        console.warn(
          `⚠ No hay sesiones guardadas para ${userId}, estableciendo valores por defecto.`
        );
        setSessions({ "Planta 1": [], "Planta 2": [] });
      }
    };

    cargarSesionesUsuario();
  }, []);

  // 🔹 Calcular las horas solo con las sesiones del usuario actual
  const totalHorasUsuario = useMemo(() => {
    return calculateTotalHours(sessions);
  }, [sessions]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Resumen de Horas</Text>

      <FlatList
        data={totalHorasUsuario.detailedReport}
        keyExtractor={(item) => item.plant}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.plant}</Text>
            {(Array.isArray(item.records) ? item.records : []).map(
              (session, index) => (
                <View key={index} style={styles.row}>
                  <Text style={styles.cell}>{session.date}</Text>
                  <Text style={styles.cell}>{session.entry}</Text>
                  <Text style={styles.cell}>{session.exit}</Text>
                  <Text style={styles.cell}>
                    {`${session.hours}h ${session.minutes}m`}
                  </Text>
                </View>
              )
            )}

            <Text style={styles.totalPlantText}>
              🔹 Total en {item.plant}: {item.totalHours}h {item.totalMinutes}m
            </Text>
          </View>
        )}
      />

      <View style={styles.totalContainer}>
        <Text style={styles.totalText}>
          🔥 Total general: {totalHorasUsuario.totalHours} horas{" "}
          {totalHorasUsuario.totalRemainingMinutes} minutos
        </Text>
      </View>
    </View>
  );
};

export default CalcularHorasScreen;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#f4f4f4" },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  card: {
    backgroundColor: "#fff",
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 5,
    color: "#2c3e50",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  cell: { fontSize: 16, color: "#34495e" },
  totalPlantText: {
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 5,
    color: "#27ae60",
  },
  totalContainer: {
    marginTop: 20,
    padding: 10,
    backgroundColor: "#2ecc71",
    borderRadius: 8,
  },
  totalText: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    color: "white",
  },
});
