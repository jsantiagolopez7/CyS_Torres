import React, { useState } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

/**
 * Calcula las horas, minutos y detecta si un turno cruza días
 * @param {string|Date} entry - Fecha y hora de entrada
 * @param {string|Date} exit - Fecha y hora de salida
 * @returns {Object} - { hours, minutes, isCrossDay }
 */
const calculateSessionHours = (entry, exit) => {
  if (!entry || !exit) return { hours: 0, minutes: 0 };

  try {
    const entryDate = new Date(entry);
    const exitDate = new Date(exit);

    // Verificar si es un turno nocturno (salida en día posterior)
    const isSameDay = entryDate.toDateString() === exitDate.toDateString();

    // Calcular diferencia en milisegundos
    let diffMs = exitDate - entryDate;

    // Convertir a horas y minutos
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return { hours, minutes, isCrossDay: !isSameDay };
  } catch (error) {
    console.error("Error en cálculo de horas:", error);
    return { hours: 0, minutes: 0 };
  }
};

export const calculateTotalHours = (
  sessions,
  filterPlant = null,
  filterDay = null
) => {
  let totalMinutes = 0;
  let detailedReport = [];

  Object.keys(sessions).forEach((plant) => {
    if (filterPlant && plant !== filterPlant) return; // Filtrar plantas si es necesario

    let plantMinutes = 0;
    let plantReport = [];

    sessions[plant].forEach((session) => {
      if (!session.entry || !session.exit) {
        console.warn(`⚠ Sesión inválida en ${plant}:`, session);
        return; // ⏩ Omitir sesión con datos faltantes
      }

      const entryTime = normalizeDate(session.entry); // ✅ Usar directamente el timestamp de entrada
      const exitTime = normalizeDate(session.exit); // ✅ Usar directamente el timestamp de salida

      // 🔥 Validar que las fechas sean correctas antes de calcular
      if (!entryTime || !exitTime) {
        console.warn(
          `⚠ Fecha inválida en ${plant}: entry=${session.entry}, exit=${session.exit}`
        );
        return; // ⏩ Saltar sesión inválida
      }

      const sessionDay = entryTime.toISOString().split("T")[0];

      if (filterDay && sessionDay !== filterDay) return; // Filtrar por día si es necesario

      // Usar la nueva función para calcular horas y minutos
      const { hours, minutes, isCrossDay } = calculateSessionHours(
        entryTime,
        exitTime
      );

      // Sumar los minutos totales (horas * 60 + minutos)
      plantMinutes += hours * 60 + minutes;

      plantReport.push({
        date: sessionDay,
        entry: entryTime.toLocaleTimeString("es-CO"),
        exit: exitTime.toLocaleTimeString("es-CO"),
        hours,
        minutes,
        isCrossDay, // Nuevo campo para identificar turnos que cruzan días
      });
    });

    detailedReport.push({
      plant,
      records: plantReport,
      totalHours: Math.floor(plantMinutes / 60),
      totalMinutes: plantMinutes % 60,
    });

    totalMinutes += plantMinutes;
  });

  return {
    totalHours: Math.floor(totalMinutes / 60),
    totalRemainingMinutes: totalMinutes % 60,
    detailedReport,
  };
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

const RegistroHorasScreen = ({ sessions }) => {
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const { totalHours, totalRemainingMinutes, detailedReport } =
    calculateTotalHours(sessions, selectedPlant, selectedDay);

  const allDays = Object.values(sessions)
    .flat()
    .map((session) => new Date(session.entry).toISOString().split("T")[0])
    .filter((value, index, self) => self.indexOf(value) === index);

  const plants = Object.keys(sessions);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Registro de Horas</Text>

      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.filterText}>🔍 Filtrar</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={detailedReport}
        keyExtractor={(item) => item.plant}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.plant}</Text>
            {item.records.length > 0 ? (
              item.records.map((session, index) => (
                <View key={index} style={styles.row}>
                  <Text style={styles.cell}>{session.date}</Text>
                  <Text style={styles.cell}>{session.entry}</Text>
                  <Text style={styles.cell}>{session.exit}</Text>
                  <Text
                    style={styles.cell}
                  >{`${session.hours}h ${session.minutes}m`}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.noData}>No hay registros</Text>
            )}
            <Text style={styles.totalPlantText}>
              🔹 Total en {item.plant}: {item.totalHours}h {item.totalMinutes}m
            </Text>
          </View>
        )}
      />

      <View style={styles.totalContainer}>
        <Text style={styles.totalText}>
          🔥 Total general: {totalHours} horas {totalRemainingMinutes} minutos
        </Text>
      </View>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Filtrar por:</Text>
          <Text style={styles.subtitle}>Planta:</Text>
          {plants.map((plant) => (
            <TouchableOpacity
              key={plant}
              style={styles.filterItem}
              onPress={() => {
                setSelectedPlant(plant);
                setModalVisible(false);
              }}
            >
              <Text style={styles.filterText}>{plant}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.subtitle}>Día:</Text>
          {allDays.map((day) => (
            <TouchableOpacity
              key={day}
              style={styles.filterItem}
              onPress={() => {
                setSelectedDay(day);
                setModalVisible(false);
              }}
            >
              <Text style={styles.filterText}>{day}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.clearFilter}
            onPress={() => {
              setSelectedPlant(null);
              setSelectedDay(null);
              setModalVisible(false);
            }}
          >
            <Text style={styles.filterText}>❌ Borrar Filtros</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeModal}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.filterText}>🔙 Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

export default RegistroHorasScreen;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#f4f4f4" },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  filterContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 15,
  },
  filterButton: { backgroundColor: "#3498db", padding: 10, borderRadius: 5 },
  filterText: { color: "white", fontWeight: "bold", textAlign: "center" },
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
  noData: { fontSize: 14, color: "#999", textAlign: "center", marginTop: 5 },
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
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 15,
    color: "white",
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 5,
    color: "white",
  },
  filterItem: {
    backgroundColor: "#3498db",
    padding: 10,
    margin: 5,
    borderRadius: 5,
    width: "80%",
  },
  clearFilter: {
    backgroundColor: "#e74c3c",
    padding: 10,
    marginTop: 10,
    borderRadius: 5,
    width: "80%",
  },
  closeModal: {
    backgroundColor: "#95a5a6",
    padding: 10,
    marginTop: 10,
    borderRadius: 5,
    width: "80%",
  },
});
