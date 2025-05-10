import { FontAwesome5, MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { es } from "date-fns/locale";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { collection, getDocs, query, where } from "firebase/firestore";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../database/firebase";

const Reporte = () => {
  // Estados para gestión de datos
  const [jornadas, setJornadas] = useState([]);
  const [filteredJornadas, setFilteredJornadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedJornada, setSelectedJornada] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Estados para filtros
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState("semanal");
  const [fechaInicio, setFechaInicio] = useState(null);
  const [fechaFin, setFechaFin] = useState(null);

  // Estados para estadísticas
  const [estadisticas, setEstadisticas] = useState({
    totalHoras: "0",
    totalMinutos: "0",
    totalRegistros: 0,
    planta1Horas: "0",
    planta2Horas: "0",
  });

  // Obtener datos al iniciar el componente
  useEffect(() => {
    obtenerJornadas();
  }, []);

  // Actualizar filtros cuando cambia el período seleccionado
  useEffect(() => {
    actualizarFiltroFechas(periodoSeleccionado);
  }, [periodoSeleccionado]);

  // Filtrar jornadas cuando cambian los filtros
  useEffect(() => {
    if (jornadas.length > 0 && fechaInicio && fechaFin) {
      filtrarJornadasPorFecha();
    }
  }, [jornadas, fechaInicio, fechaFin]);

  // Handler de refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    obtenerJornadas();
  }, []);

  /**
   * Función para obtener las jornadas desde Firestore y AsyncStorage
   */
  const obtenerJornadas = async () => {
    try {
      if (!auth.currentUser) {
        Alert.alert("Error", "Debes iniciar sesión para ver el reporte.");
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setLoading(true);
      const userId = auth.currentUser.uid;

      // 1. Primero intentar obtener datos de AsyncStorage para funcionamiento offline
      const localSessionsJson = await AsyncStorage.getItem(
        `sessions_${userId}`
      );
      let localJornadas = [];

      if (localSessionsJson) {
        try {
          const localSessions = JSON.parse(localSessionsJson);

          // Convertir las sesiones locales a formato compatible con jornadas
          if (localSessions && typeof localSessions === "object") {
            const today = new Date().toISOString().split("T")[0];

            localJornadas = [
              {
                id: `local_${today}`,
                userId,
                fecha: today,
                plantas: localSessions,
                tipo: "local",
                esLocal: true,
              },
            ];
          }
        } catch (error) {
          console.warn("Error al procesar sesiones locales:", error);
        }
      }

      // 2. Obtener jornadas desde Firestore
      let jornadasData = [];

      // Jornadas completas - MODIFICADO: Eliminar orderBy para evitar error de índice
      const jornadasRef = collection(db, "jornadas");
      const qJornadas = query(
        jornadasRef,
        where("userId", "==", userId)
        // Se eliminó orderBy("fecha", "desc") temporalmente mientras se compila el índice
      );

      try {
        const jornadasSnapshot = await getDocs(qJornadas);
        jornadasData = jornadasSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          tipo: "jornada",
        }));

        // Ordenar en JavaScript después de obtener los datos
        jornadasData.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      } catch (error) {
        console.warn("Error obteniendo jornadas de Firestore:", error);
        // Continuar con cualquier dato disponible
      }

      // 3. Obtener los registros individuales
      const registrosRef = collection(db, "registros");
      const qRegistros = query(registrosRef, where("userId", "==", userId));

      let registrosAgrupados = {};

      try {
        const registrosSnapshot = await getDocs(qRegistros);

        // Agrupar registros por fecha
        registrosAgrupados = registrosSnapshot.docs.reduce((acc, doc) => {
          const datos = doc.data();
          if (!datos.dateTime) return acc;

          // Convertir a fecha local
          const fecha = new Date(datos.dateTime);
          const fechaString = format(fecha, "yyyy-MM-dd");

          if (!acc[fechaString]) {
            acc[fechaString] = {
              fecha: fechaString,
              plantas: {},
            };
          }

          const planta = datos.plant || "Sin especificar";
          if (!acc[fechaString].plantas[planta]) {
            acc[fechaString].plantas[planta] = [];
          }

          acc[fechaString].plantas[planta].push({
            ...datos,
            id: doc.id,
          });

          return acc;
        }, {});
      } catch (error) {
        console.warn("Error obteniendo registros de Firestore:", error);
      }

      // Convertir registros agrupados a array
      const registrosJornadas = Object.values(registrosAgrupados).map(
        (jornada) => {
          // Calcular horas totales para esta jornada
          let horasTotales = 0;
          let minutosTotales = 0;

          Object.values(jornada.plantas).forEach((registrosPlanta) => {
            // Ordenar por tiempo
            registrosPlanta.sort(
              (a, b) => new Date(a.dateTime) - new Date(b.dateTime)
            );

            // Calcular horas por pares entrada/salida
            for (let i = 0; i < registrosPlanta.length - 1; i += 2) {
              const entrada = registrosPlanta[i];
              const salida = registrosPlanta[i + 1];

              if (
                entrada &&
                salida &&
                entrada.action === "Entrada" &&
                salida.action === "Salida"
              ) {
                const diffMs =
                  new Date(salida.dateTime) - new Date(entrada.dateTime);
                horasTotales += Math.floor(diffMs / (1000 * 60 * 60));
                minutosTotales += Math.floor(
                  (diffMs % (1000 * 60 * 60)) / (1000 * 60)
                );
              }
            }
          });

          // Normalizar minutos
          horasTotales += Math.floor(minutosTotales / 60);
          minutosTotales = minutosTotales % 60;

          return {
            id: `registro_${jornada.fecha}`,
            fecha: jornada.fecha,
            plantas: jornada.plantas,
            totalHoras: `${horasTotales}h ${minutosTotales}m`,
            horasNumero: horasTotales + minutosTotales / 60,
            tipo: "registro",
          };
        }
      );

      // 4. Combinar todas las fuentes de datos
      const todasJornadas = [
        ...jornadasData,
        ...registrosJornadas,
        ...localJornadas,
      ];

      // Eliminar duplicados basados en fecha
      const fechasUnicas = new Set();
      const jornadasUnicas = todasJornadas.filter((jornada) => {
        if (!fechasUnicas.has(jornada.fecha)) {
          fechasUnicas.add(jornada.fecha);
          return true;
        }
        return false;
      });

      // Ordenar por fecha, más recientes primero
      const jornadasOrdenadas = jornadasUnicas.sort(
        (a, b) => new Date(b.fecha) - new Date(a.fecha)
      );

      setJornadas(jornadasOrdenadas);

      // Configurar filtro inicial a la semana actual por defecto
      actualizarFiltroFechas("semanal");

      // Calcular estadísticas
      calcularEstadisticas(jornadasOrdenadas);
    } catch (error) {
      console.error("Error al obtener jornadas:", error);
      Alert.alert("Error", "Hubo un problema al cargar tus registros.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  /**
   * Calcular estadísticas generales y por planta
   */
  const calcularEstadisticas = (jornadasData) => {
    let totalHoras = 0;
    let totalMinutos = 0;
    let planta1Horas = 0;
    let planta1Minutos = 0;
    let planta2Horas = 0;
    let planta2Minutos = 0;

    jornadasData.forEach((jornada) => {
      // Sumar horas totales si ya están calculadas
      if (jornada.horasNumero) {
        totalHoras += Math.floor(jornada.horasNumero);
        totalMinutos += Math.round((jornada.horasNumero % 1) * 60);
      }

      // Calcular desde plantas para reportes detallados
      if (jornada.plantas) {
        // Para Planta 1
        if (jornada.plantas["Planta 1"]) {
          jornada.plantas["Planta 1"].forEach((sesion) => {
            if (sesion.entry && sesion.exit) {
              const diffMs = new Date(sesion.exit) - new Date(sesion.entry);
              const horasPlanta = diffMs / (1000 * 60 * 60);
              planta1Horas += Math.floor(horasPlanta);
              planta1Minutos += Math.round((horasPlanta % 1) * 60);
            }
          });
        }

        // Para Planta 2
        if (jornada.plantas["Planta 2"]) {
          jornada.plantas["Planta 2"].forEach((sesion) => {
            if (sesion.entry && sesion.exit) {
              const diffMs = new Date(sesion.exit) - new Date(sesion.entry);
              const horasPlanta = diffMs / (1000 * 60 * 60);
              planta2Horas += Math.floor(horasPlanta);
              planta2Minutos += Math.round((horasPlanta % 1) * 60);
            }
          });
        }
      }
    });

    // Normalizar minutos
    planta1Horas += Math.floor(planta1Minutos / 60);
    planta1Minutos = planta1Minutos % 60;

    planta2Horas += Math.floor(planta2Minutos / 60);
    planta2Minutos = planta2Minutos % 60;

    totalHoras += Math.floor(totalMinutos / 60);
    totalMinutos = totalMinutos % 60;

    setEstadisticas({
      totalHoras: totalHoras.toString(),
      totalMinutos: totalMinutos.toString(),
      totalRegistros: jornadasData.length,
      planta1Horas: `${planta1Horas}h ${planta1Minutos}m`,
      planta2Horas: `${planta2Horas}h ${planta2Minutos}m`,
    });
  };

  /**
   * Actualizar el rango de fechas según el período seleccionado
   */
  const actualizarFiltroFechas = (periodo) => {
    const hoy = new Date();
    let inicio, fin;

    switch (periodo) {
      case "diario":
        inicio = new Date(hoy.setHours(0, 0, 0, 0));
        fin = new Date(hoy.setHours(23, 59, 59, 999));
        break;

      case "semanal":
        inicio = startOfWeek(hoy, { weekStartsOn: 1 }); // Semana comienza el lunes
        fin = endOfWeek(hoy, { weekStartsOn: 1 });
        break;

      case "mensual":
        inicio = startOfMonth(hoy);
        fin = endOfMonth(hoy);
        break;

      case "ultimaSemana":
        inicio = startOfWeek(subWeeks(hoy, 1), { weekStartsOn: 1 });
        fin = endOfWeek(subWeeks(hoy, 1), { weekStartsOn: 1 });
        break;

      case "ultimoMes":
        inicio = startOfMonth(subMonths(hoy, 1));
        fin = endOfMonth(subMonths(hoy, 1));
        break;

      default:
        inicio = startOfWeek(hoy, { weekStartsOn: 1 });
        fin = endOfWeek(hoy, { weekStartsOn: 1 });
    }

    setFechaInicio(inicio);
    setFechaFin(fin);
    setPeriodoSeleccionado(periodo);
  };

  /**
   * Filtrar jornadas por rango de fechas
   */
  const filtrarJornadasPorFecha = () => {
    if (!fechaInicio || !fechaFin) return;

    const inicioMs = fechaInicio.getTime();
    const finMs = fechaFin.getTime();

    const filtradas = jornadas.filter((jornada) => {
      const fechaJornada = new Date(jornada.fecha);
      const fechaMs = fechaJornada.getTime();
      return fechaMs >= inicioMs && fechaMs <= finMs;
    });

    setFilteredJornadas(filtradas);
    calcularEstadisticas(filtradas);
  };

  /**
   * Formatear fecha en formato colombiano
   */
  const formatColombianDateTime = (dateString) => {
    if (!dateString) return "Fecha no disponible";

    try {
      const date = new Date(dateString);

      if (isNaN(date.getTime())) return "Fecha inválida";

      return format(date, "dd/MM/yyyy HH:mm", { locale: es });
    } catch (error) {
      console.warn("Error formateando fecha:", error);
      return "Formato incorrecto";
    }
  };

  /**
   * Calcular duración entre dos fechas y formatear como horas y minutos
   */
  const calculateDuration = (startDate, endDate) => {
    if (!startDate || !endDate) return "N/A";

    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffMs = end - start;

      if (isNaN(diffMs)) return "Fecha inválida";

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      return `${hours}h ${minutes}m`;
    } catch (error) {
      console.warn("Error calculando duración:", error);
      return "Error de cálculo";
    }
  };

  /**
   * Exportar reporte en formato PDF
   */
  const exportarReporte = async () => {
    if (!filteredJornadas || filteredJornadas.length === 0) {
      Alert.alert(
        "Sin datos",
        "No hay registros en el período seleccionado para exportar."
      );
      return;
    }

    // Obtener el rango de fechas para el título
    const inicioStr = format(fechaInicio, "dd/MM/yyyy", { locale: es });
    const finStr = format(fechaFin, "dd/MM/yyyy", { locale: es });
    const periodoTexto =
      periodoSeleccionado === "diario"
        ? "Diario"
        : periodoSeleccionado === "semanal"
        ? "Semanal"
        : periodoSeleccionado === "mensual"
        ? "Mensual"
        : periodoSeleccionado === "ultimaSemana"
        ? "Última semana"
        : periodoSeleccionado === "ultimoMes"
        ? "Último mes"
        : "Personalizado";

    let contenidoHTML = `
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6; }
            h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
            h2 { color: #2980b9; margin-top: 30px; border-bottom: 1px solid #bdc3c7; padding-bottom: 5px; }
            .resumen { background-color: #f8f9fa; border-left: 4px solid #3498db; padding: 15px; margin-bottom: 25px; }
            .fecha { color: #7f8c8d; font-style: italic; margin-bottom: 5px; }
            .jornada { margin-bottom: 35px; background-color: #fff; border: 1px solid #e0e0e0; border-radius: 5px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
            .planta { margin: 15px 0; padding: 10px; background-color: #ebf5fb; border-radius: 4px; }
            .planta-title { font-weight: bold; color: #2980b9; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
            th { background-color: #f2f6f9; text-align: left; padding: 10px; border: 1px solid #ddd; }
            td { padding: 8px 10px; border: 1px solid #ddd; vertical-align: middle; }
            .total { font-weight: bold; margin-top: 15px; text-align: right; color: #16a085; }
            .footer { margin-top: 30px; text-align: center; color: #7f8c8d; font-size: 0.9em; border-top: 1px solid #ecf0f1; padding-top: 15px; }
            .estadisticas { display: flex; justify-content: space-between; margin: 20px 0; }
            .estadistica-item { flex: 1; text-align: center; border-right: 1px solid #ddd; padding: 0 10px; }
            .estadistica-item:last-child { border-right: none; }
            .estadistica-valor { font-size: 20px; font-weight: bold; color: #16a085; margin: 8px 0; }
            .estadistica-label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h1>Reporte de Jornadas Laborales - ${periodoTexto}</h1>
          <p class="fecha">Período: ${inicioStr} al ${finStr}</p>
          
          <div class="resumen">
            <div class="estadisticas">
              <div class="estadistica-item">
                <div class="estadistica-valor">${estadisticas.totalRegistros}</div>
                <div class="estadistica-label">Jornadas</div>
              </div>
              <div class="estadistica-item">
                <div class="estadistica-valor">${estadisticas.totalHoras}h ${estadisticas.totalMinutos}m</div>
                <div class="estadistica-label">Horas totales</div>
              </div>
              <div class="estadistica-item">
                <div class="estadistica-valor">${estadisticas.planta1Horas}</div>
                <div class="estadistica-label">Planta 1</div>
              </div>
              <div class="estadistica-item">
                <div class="estadistica-valor">${estadisticas.planta2Horas}</div>
                <div class="estadistica-label">Planta 2</div>
              </div>
            </div>
          </div>
    `;

    filteredJornadas.forEach((jornada, index) => {
      const fechaFormateada = format(new Date(jornada.fecha), "dd MMMM yyyy", {
        locale: es,
      });

      contenidoHTML += `
        <div class="jornada">
          <h2>Jornada ${index + 1} - ${fechaFormateada}</h2>
      `;

      if (jornada.plantas) {
        Object.entries(jornada.plantas).forEach(([planta, sesiones]) => {
          contenidoHTML += `
            <div class="planta">
              <div class="planta-title">${planta}</div>
              <table>
                <tr>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Horas</th>
                </tr>
          `;

          // Para jornadas
          if (Array.isArray(sesiones)) {
            sesiones.forEach((sesion) => {
              if (sesion.entry) {
                const horasTrabajadas = sesion.exit
                  ? (
                      (new Date(sesion.exit) - new Date(sesion.entry)) /
                      (1000 * 60 * 60)
                    ).toFixed(2) + "h"
                  : "En progreso";

                contenidoHTML += `
                  <tr>
                    <td>${formatColombianDateTime(sesion.entry)}</td>
                    <td>${
                      sesion.exit
                        ? formatColombianDateTime(sesion.exit)
                        : "Pendiente"
                    }</td>
                    <td>${horasTrabajadas}</td>
                  </tr>
                `;
              }
            });
          }
          // Para registros
          else {
            for (let i = 0; i < sesiones.length; i += 2) {
              const entrada = sesiones[i];
              const salida = i + 1 < sesiones.length ? sesiones[i + 1] : null;

              if (entrada && entrada.action === "Entrada") {
                const horasTrabajadas =
                  salida && salida.action === "Salida"
                    ? (
                        (new Date(salida.dateTime) -
                          new Date(entrada.dateTime)) /
                        (1000 * 60 * 60)
                      ).toFixed(2) + "h"
                    : "En progreso";

                contenidoHTML += `
                  <tr>
                    <td>${formatColombianDateTime(entrada.dateTime)}</td>
                    <td>${
                      salida
                        ? formatColombianDateTime(salida.dateTime)
                        : "Pendiente"
                    }</td>
                    <td>${horasTrabajadas}</td>
                  </tr>
                `;
              }
            }
          }

          contenidoHTML += `
              </table>
            </div>
          `;
        });
      }

      contenidoHTML += `
          <p class="total">Total Jornada: ${jornada.totalHoras || "0h"}</p>
        </div>
      `;
    });

    contenidoHTML += `
          <div class="footer">
            <p>Reporte generado el ${formatColombianDateTime(new Date())}</p>
          </div>
        </body>
      </html>
    `;

    try {
      const { uri } = await Print.printToFileAsync({ html: contenidoHTML });

      if (Platform.OS === "ios") {
        await Sharing.shareAsync(uri);
      } else {
        await Sharing.shareAsync(uri, {
          UTI: ".pdf",
          mimeType: "application/pdf",
        });
      }
    } catch (error) {
      console.error("Error al exportar el reporte:", error);
      Alert.alert("Error", "Hubo un problema al exportar el reporte.");
    }
  };

  /**
   * Exportar jornada individual como PDF
   */
  const exportarJornadaIndividual = async (jornada) => {
    if (!jornada) {
      Alert.alert("Error", "No hay datos para exportar");
      return;
    }

    const fechaFormateada = format(new Date(jornada.fecha), "dd MMMM yyyy", {
      locale: es,
    });

    let contenidoHTML = `
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6; }
            h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
            h2 { color: #2980b9; margin-top: 30px; border-bottom: 1px solid #bdc3c7; padding-bottom: 5px; }
            .planta { margin: 15px 0; padding: 10px; background-color: #ebf5fb; border-radius: 4px; }
            .planta-title { font-weight: bold; color: #2980b9; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
            th { background-color: #f2f6f9; text-align: left; padding: 10px; border: 1px solid #ddd; }
            td { padding: 8px 10px; border: 1px solid #ddd; vertical-align: middle; }
            .total { font-weight: bold; margin-top: 15px; text-align: right; color: #16a085; }
            .footer { margin-top: 30px; text-align: center; color: #7f8c8d; font-size: 0.9em; border-top: 1px solid #ecf0f1; padding-top: 15px; }
          </style>
        </head>
        <body>
          <h1>Detalle de Jornada - ${fechaFormateada}</h1>
    `;

    if (jornada.plantas) {
      Object.entries(jornada.plantas).forEach(([planta, sesiones]) => {
        contenidoHTML += `
          <div class="planta">
            <div class="planta-title">${planta}</div>
            <table>
              <tr>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Horas</th>
              </tr>
        `;

        // Para jornadas
        if (Array.isArray(sesiones)) {
          sesiones.forEach((sesion) => {
            if (sesion.entry) {
              const horasTrabajadas = sesion.exit
                ? (
                    (new Date(sesion.exit) - new Date(sesion.entry)) /
                    (1000 * 60 * 60)
                  ).toFixed(2) + "h"
                : "En progreso";

              contenidoHTML += `
                <tr>
                  <td>${formatColombianDateTime(sesion.entry)}</td>
                  <td>${
                    sesion.exit
                      ? formatColombianDateTime(sesion.exit)
                      : "Pendiente"
                  }</td>
                  <td>${horasTrabajadas}</td>
                </tr>
              `;
            }
          });
        }
        // Para registros
        else {
          for (let i = 0; i < sesiones.length; i += 2) {
            const entrada = sesiones[i];
            const salida = i + 1 < sesiones.length ? sesiones[i + 1] : null;

            if (entrada && entrada.action === "Entrada") {
              const horasTrabajadas =
                salida && salida.action === "Salida"
                  ? (
                      (new Date(salida.dateTime) - new Date(entrada.dateTime)) /
                      (1000 * 60 * 60)
                    ).toFixed(2) + "h"
                  : "En progreso";

              contenidoHTML += `
                <tr>
                  <td>${formatColombianDateTime(entrada.dateTime)}</td>
                  <td>${
                    salida
                      ? formatColombianDateTime(salida.dateTime)
                      : "Pendiente"
                  }</td>
                  <td>${horasTrabajadas}</td>
                </tr>
              `;
            }
          }
        }

        contenidoHTML += `
            </table>
          </div>
        `;
      });
    }

    contenidoHTML += `
        <p class="total">Total Jornada: ${jornada.totalHoras || "0h"}</p>
        <div class="footer">
          <p>Reporte generado el ${formatColombianDateTime(new Date())}</p>
        </div>
      </body>
    </html>
    `;

    try {
      const { uri } = await Print.printToFileAsync({ html: contenidoHTML });
      await Sharing.shareAsync(uri, {
        UTI: ".pdf",
        mimeType: "application/pdf",
      });
    } catch (error) {
      console.error("Error al exportar el reporte individual:", error);
      Alert.alert("Error", "Hubo un problema al exportar el reporte.");
    }
  };

  /**
   * Abrir ubicación en Google Maps
   */
  const abrirUbicacion = (coords) => {
    if (!coords || !coords.latitude || !coords.longitude) {
      Alert.alert(
        "Error",
        "No hay coordenadas disponibles para esta ubicación"
      );
      return;
    }

    const { latitude, longitude } = coords;
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(url);
        } else {
          Alert.alert("Error", "No se puede abrir Google Maps");
        }
      })
      .catch((error) => {
        console.error("Error abriendo maps:", error);
        Alert.alert("Error", "No se pudo abrir la ubicación");
      });
  };

  /**
   * Renderizar selector de período
   */
  const renderPeriodoSelector = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.periodSelector}
    >
      <TouchableOpacity
        style={[
          styles.periodButton,
          periodoSeleccionado === "diario" && styles.periodButtonActive,
        ]}
        onPress={() => actualizarFiltroFechas("diario")}
      >
        <Text
          style={[
            styles.periodButtonText,
            periodoSeleccionado === "diario" && styles.periodButtonTextActive,
          ]}
        >
          Hoy
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.periodButton,
          periodoSeleccionado === "semanal" && styles.periodButtonActive,
        ]}
        onPress={() => actualizarFiltroFechas("semanal")}
      >
        <Text
          style={[
            styles.periodButtonText,
            periodoSeleccionado === "semanal" && styles.periodButtonTextActive,
          ]}
        >
          Esta semana
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.periodButton,
          periodoSeleccionado === "mensual" && styles.periodButtonActive,
        ]}
        onPress={() => actualizarFiltroFechas("mensual")}
      >
        <Text
          style={[
            styles.periodButtonText,
            periodoSeleccionado === "mensual" && styles.periodButtonTextActive,
          ]}
        >
          Este mes
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.periodButton,
          periodoSeleccionado === "ultimaSemana" && styles.periodButtonActive,
        ]}
        onPress={() => actualizarFiltroFechas("ultimaSemana")}
      >
        <Text
          style={[
            styles.periodButtonText,
            periodoSeleccionado === "ultimaSemana" &&
              styles.periodButtonTextActive,
          ]}
        >
          Última semana
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.periodButton,
          periodoSeleccionado === "ultimoMes" && styles.periodButtonActive,
        ]}
        onPress={() => actualizarFiltroFechas("ultimoMes")}
      >
        <Text
          style={[
            styles.periodButtonText,
            periodoSeleccionado === "ultimoMes" &&
              styles.periodButtonTextActive,
          ]}
        >
          Último mes
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  /**
   * Renderizar rango de fechas
   */
  const renderFechaRange = () => {
    if (!fechaInicio || !fechaFin) return null;

    return (
      <View style={styles.dateRangeContainer}>
        <MaterialIcons name="date-range" size={20} color="#2980b9" />
        <Text style={styles.dateRangeText}>
          {format(fechaInicio, "dd MMM", { locale: es })} -{" "}
          {format(fechaFin, "dd MMM yyyy", { locale: es })}
        </Text>
      </View>
    );
  };

  /**
   * Renderizar estadísticas
   */
  const renderEstadisticas = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{estadisticas.totalRegistros}</Text>
        <Text style={styles.statLabel}>Jornadas</Text>
      </View>

      <View style={styles.statItem}>
        <Text style={styles.statValue}>
          {estadisticas.totalHoras}h {estadisticas.totalMinutos}m
        </Text>
        <Text style={styles.statLabel}>Total horas</Text>
      </View>

      <View style={styles.statItem}>
        <Text style={styles.statValue}>{estadisticas.planta1Horas}</Text>
        <Text style={styles.statLabel}>Planta 1</Text>
      </View>

      <View style={[styles.statItem, styles.statItemLast]}>
        <Text style={styles.statValue}>{estadisticas.planta2Horas}</Text>
        <Text style={styles.statLabel}>Planta 2</Text>
      </View>
    </View>
  );

  /**
   * Renderizar un elemento de jornada
   */
  const renderJornadaItem = ({ item }) => {
    // Formatear la fecha para mostrar
    const fechaFormateada = format(new Date(item.fecha), "dd MMMM yyyy", {
      locale: es,
    });

    return (
      <TouchableOpacity
        style={[
          styles.jornadaCard,
          item.esLocal && styles.jornadaCardLocal, // Destacar jornadas locales/en curso
        ]}
        onPress={() => {
          setSelectedJornada(item);
          setModalVisible(true);
        }}
      >
        <View style={styles.jornadaHeader}>
          <Text style={styles.jornadaFecha}>{fechaFormateada}</Text>
          <View style={styles.jornadaBadge}>
            <Text style={styles.jornadaBadgeText}>
              {item.totalHoras || "0h"}
            </Text>
          </View>
        </View>

        {/* Plantas trabajadas */}
        <View style={styles.plantasContainer}>
          {item.plantas &&
            Object.keys(item.plantas).map((planta) => (
              <View key={planta} style={styles.plantaTag}>
                <FontAwesome5
                  name="industry"
                  size={12}
                  color="#555"
                  style={styles.plantaIcon}
                />
                <Text style={styles.plantaText}>{planta}</Text>
              </View>
            ))}
        </View>

        {/* Vista previa de la primera imagen si existe */}
        {item.plantas &&
          Object.values(item.plantas).some((sesiones) =>
            Array.isArray(sesiones)
              ? sesiones.some((s) => s.entryImage)
              : sesiones.some((s) => s.imageUri)
          ) && (
            <View style={styles.previewImageContainer}>
              <Text style={styles.previewLabel}>
                <MaterialIcons name="photo" size={14} color="#666" />
                Imágenes disponibles
              </Text>
            </View>
          )}

        {/* Indicador para jornadas locales */}
        {item.esLocal && (
          <View style={styles.localBadge}>
            <MaterialIcons name="sync" size={14} color="#fff" />
            <Text style={styles.localBadgeText}>En curso</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.verDetallesButton}
          onPress={() => {
            setSelectedJornada(item);
            setModalVisible(true);
          }}
        >
          <Text style={styles.verDetallesText}>Ver detalles</Text>
          <MaterialIcons name="arrow-forward" size={16} color="#3498db" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  /**
   * Renderizar Modal para vista detallada
   */
  const renderJornadaDetalle = () => {
    if (!selectedJornada || !modalVisible) return null;

    return (
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
            >
              <MaterialIcons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Detalle de Jornada</Text>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalFecha}>
              {format(new Date(selectedJornada.fecha), "dd MMMM yyyy", {
                locale: es,
              })}
            </Text>

            <Text style={styles.modalHoras}>
              {selectedJornada.totalHoras || "0h"}
            </Text>

            {/* Detalles por planta */}
            {selectedJornada.plantas &&
              Object.entries(selectedJornada.plantas).map(
                ([nombrePlanta, sesiones]) => (
                  <View key={nombrePlanta} style={styles.modalPlantaSection}>
                    <Text style={styles.modalPlantaTitle}>{nombrePlanta}</Text>

                    {/* Sesiones de la planta */}
                    {Array.isArray(sesiones) && sesiones.length > 0 ? (
                      sesiones.map((sesion, indexSesion) => {
                        // Determinar los tiempos de entrada/salida según el tipo de registro
                        const entrada = sesion.entry || sesion.dateTime;
                        const salida =
                          sesion.exit ||
                          (sesion.action === "Salida" && sesion.dateTime);
                        const imagenEntrada =
                          sesion.entryImage ||
                          (sesion.action === "Entrada" && sesion.imageUri);
                        const imagenSalida =
                          sesion.exitImage ||
                          (sesion.action === "Salida" && sesion.imageUri);
                        const ubicacionEntrada =
                          sesion.entryLocation ||
                          (sesion.action === "Entrada" && sesion.location);
                        const ubicacionSalida =
                          sesion.exitLocation ||
                          (sesion.action === "Salida" && sesion.location);

                        // Solo mostrar la sesión si hay entrada
                        if (!entrada) return null;

                        return (
                          <View
                            key={indexSesion}
                            style={styles.modalSesionCard}
                          >
                            <View style={styles.modalSesionRow}>
                              <View style={styles.modalTimeBlock}>
                                <Text style={styles.modalTimeLabel}>
                                  Entrada:
                                </Text>
                                <Text style={styles.modalTimeValue}>
                                  {formatColombianDateTime(entrada)}
                                </Text>
                              </View>

                              <View style={styles.modalTimeBlock}>
                                <Text style={styles.modalTimeLabel}>
                                  Salida:
                                </Text>
                                <Text style={styles.modalTimeValue}>
                                  {salida
                                    ? formatColombianDateTime(salida)
                                    : "Pendiente"}
                                </Text>
                              </View>
                            </View>

                            {/* Imágenes */}
                            {(imagenEntrada || imagenSalida) && (
                              <View style={styles.modalImageRow}>
                                {imagenEntrada && (
                                  <View style={styles.modalImageContainer}>
                                    <Text style={styles.modalImageLabel}>
                                      Imagen Entrada
                                    </Text>
                                    <Image
                                      source={{ uri: imagenEntrada }}
                                      style={styles.modalImage}
                                      resizeMode="cover"
                                    />
                                  </View>
                                )}

                                {imagenSalida && (
                                  <View style={styles.modalImageContainer}>
                                    <Text style={styles.modalImageLabel}>
                                      Imagen Salida
                                    </Text>
                                    <Image
                                      source={{ uri: imagenSalida }}
                                      style={styles.modalImage}
                                      resizeMode="cover"
                                    />
                                  </View>
                                )}
                              </View>
                            )}

                            {/* Mostrar duración si hay entrada y salida */}
                            {entrada && salida && (
                              <View style={styles.modalDurationContainer}>
                                <MaterialIcons
                                  name="timer"
                                  size={20}
                                  color="#3498db"
                                />
                                <Text style={styles.modalDurationText}>
                                  {calculateDuration(entrada, salida)}
                                </Text>
                              </View>
                            )}

                            {/* Botones de ubicación */}
                            {(ubicacionEntrada || ubicacionSalida) && (
                              <View style={styles.modalLocationsContainer}>
                                <Text style={styles.modalLocationTitle}>
                                  Ubicaciones:
                                </Text>

                                {ubicacionEntrada && (
                                  <TouchableOpacity
                                    style={styles.modalLocationButton}
                                    onPress={() =>
                                      abrirUbicacion(ubicacionEntrada)
                                    }
                                  >
                                    <MaterialIcons
                                      name="location-on"
                                      size={18}
                                      color="white"
                                    />
                                    <Text
                                      style={styles.modalLocationButtonText}
                                    >
                                      Ver ubicación de entrada
                                    </Text>
                                  </TouchableOpacity>
                                )}

                                {ubicacionSalida && (
                                  <TouchableOpacity
                                    style={styles.modalLocationButton}
                                    onPress={() =>
                                      abrirUbicacion(ubicacionSalida)
                                    }
                                  >
                                    <MaterialIcons
                                      name="location-on"
                                      size={18}
                                      color="white"
                                    />
                                    <Text
                                      style={styles.modalLocationButtonText}
                                    >
                                      Ver ubicación de salida
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })
                    ) : (
                      <Text style={styles.modalNoSessionsText}>
                        No hay sesiones registradas para esta planta
                      </Text>
                    )}
                  </View>
                )
              )}

            {/* Botón de exportar */}
            <TouchableOpacity
              style={styles.modalExportButton}
              onPress={() => {
                setModalVisible(false);
                setTimeout(
                  () => exportarJornadaIndividual(selectedJornada),
                  300
                );
              }}
            >
              <MaterialIcons name="picture-as-pdf" size={22} color="white" />
              <Text style={styles.modalExportButtonText}>
                Exportar esta jornada
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    );
  };

  // Return principal del componente Reporte
  return (
    <SafeAreaView style={styles.container}>
      {/* Selector de período */}
      {renderPeriodoSelector()}

      {/* Rango de fechas */}
      {renderFechaRange()}

      {/* Estadísticas */}
      {!loading && renderEstadisticas()}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={styles.loadingText}>Cargando registros...</Text>
        </View>
      ) : filteredJornadas.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons
            name="event-busy"
            size={60}
            color="#bdc3c7"
            style={styles.emptyIcon}
          />
          <Text style={styles.emptyText}>
            No hay registros de jornadas para el período seleccionado
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredJornadas}
          renderItem={renderJornadaItem}
          keyExtractor={(item) => item.id}
          style={styles.listContainer}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={["#3498db"]}
            />
          }
        />
      )}

      {/* Botón de exportar */}
      {!loading && filteredJornadas.length > 0 && (
        <TouchableOpacity
          style={[
            styles.exportButton,
            filteredJornadas.length === 0 && styles.exportButtonDisabled,
          ]}
          onPress={exportarReporte}
          disabled={filteredJornadas.length === 0}
        >
          <MaterialIcons name="picture-as-pdf" size={24} color="white" />
          <Text style={styles.exportButtonText}>Exportar Reporte</Text>
        </TouchableOpacity>
      )}

      {/* Modal para vista detallada */}
      {renderJornadaDetalle()}
    </SafeAreaView>
  );
}; // Aquí cerramos la función del componente Reporte

const styles = StyleSheet.create({
  // Contenedor principal
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
    paddingTop: Platform.OS === "ios" ? 5 : 10,
  },

  // Estilos para el encabezado
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#2c3e50",
  },

  // Selector de período
  periodSelector: {
    flexDirection: "row",
    paddingVertical: 15,
    paddingHorizontal: 15,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  periodButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#f8f9fa",
  },
  periodButtonActive: {
    borderColor: "#3498db",
    backgroundColor: "#e6f3fd",
  },
  periodButtonText: {
    fontSize: 14,
    color: "#7f8c8d",
    fontWeight: "500",
  },
  periodButtonTextActive: {
    color: "#2980b9",
    fontWeight: "600",
  },

  // Contenedor de rango de fechas
  dateRangeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  dateRangeText: {
    fontSize: 15,
    color: "#2980b9",
    fontWeight: "600",
    marginLeft: 8,
  },

  // Contenedor de estadísticas
  statsContainer: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    padding: 15,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: "#ecf0f1",
  },
  statItemLast: {
    borderRightWidth: 0,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#3498db",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#7f8c8d",
    fontWeight: "500",
    textAlign: "center",
  },

  // Lista de jornadas
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 80, // Espacio para el botón flotante
  },

  // Estados vacíos y carga
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 30,
  },
  emptyText: {
    fontSize: 16,
    color: "#95a5a6",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 15,
  },
  emptyIcon: {
    marginBottom: 20,
    opacity: 0.7,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 40,
  },
  loadingText: {
    fontSize: 15,
    color: "#7f8c8d",
    marginTop: 15,
  },

  // Tarjeta de jornada
  jornadaCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderLeftWidth: 5,
    borderLeftColor: "#3498db",
  },
  jornadaCardLocal: {
    borderLeftColor: "#e67e22",
    backgroundColor: "#fff8f0",
  },
  jornadaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  jornadaFecha: {
    fontSize: 17,
    fontWeight: "700",
    color: "#2c3e50",
  },
  jornadaBadge: {
    backgroundColor: "#edf6fd",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  jornadaBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2980b9",
  },

  // Contenedor de plantas
  plantasContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  plantaTag: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#f5f7fa",
    borderRadius: 6,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e6e9ed",
  },
  plantaIcon: {
    marginRight: 5,
  },
  plantaText: {
    fontSize: 13,
    color: "#34495e",
    fontWeight: "500",
  },

  // Indicadores de estado
  localBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e67e22",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 8,
    marginBottom: 10,
  },
  localBadgeText: {
    fontSize: 13,
    color: "white",
    fontWeight: "600",
    marginLeft: 6,
  },
  previewImageContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 5,
  },
  previewLabel: {
    fontSize: 13,
    color: "#7f8c8d",
    marginLeft: 4,
  },
  verDetallesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  verDetallesText: {
    fontSize: 14,
    color: "#3498db",
    fontWeight: "600",
    marginRight: 6,
  },

  // Botón de exportar flotante
  exportButton: {
    backgroundColor: "#3498db",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 10,
    position: "absolute",
    bottom: Platform.OS === "ios" ? 30 : 25,
    left: 20,
    right: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  exportButtonDisabled: {
    backgroundColor: "#b2c5d3",
  },
  exportButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },

  // Estilos para el Modal
  modalContainer: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 3,
  },
  closeButton: {
    padding: 10,
    marginRight: 16,
    borderRadius: 8,
    backgroundColor: "#f5f7fa",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2c3e50",
    flex: 1,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  modalFecha: {
    fontSize: 24,
    fontWeight: "800",
    color: "#2c3e50",
    marginBottom: 8,
  },
  modalHoras: {
    fontSize: 18,
    color: "#3498db",
    marginBottom: 24,
    fontWeight: "600",
  },
  modalPlantaSection: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 18,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  modalPlantaTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#2c3e50",
    borderBottomWidth: 1,
    borderBottomColor: "#ecf0f1",
    paddingBottom: 14,
    marginBottom: 14,
  },
  modalSesionCard: {
    backgroundColor: "#f8f9fa",
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#3498db",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  modalSesionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 14,
  },
  modalTimeBlock: {
    flex: 1,
    minWidth: "45%",
    marginBottom: 10,
    backgroundColor: "#ffffff",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  modalTimeLabel: {
    fontSize: 14,
    color: "#7f8c8d",
    marginBottom: 4,
    fontWeight: "500",
  },
  modalTimeValue: {
    fontSize: 15,
    color: "#2c3e50",
    fontWeight: "600",
  },
  modalImageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 16,
  },
  modalImageContainer: {
    width: "48%",
    marginBottom: 12,
    backgroundColor: "#ffffff",
    padding: 8,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  modalImage: {
    width: "100%",
    height: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  modalImageFull: {
    width: "100%",
    height: 220,
    borderRadius: 8,
    marginTop: 10,
  },
  modalImageLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#34495e",
    marginBottom: 8,
    textAlign: "center",
  },
  modalNoSessionsText: {
    color: "#95a5a6",
    fontStyle: "italic",
    textAlign: "center",
    padding: 24,
    fontSize: 15,
  },
  modalLocationsContainer: {
    marginTop: 12,
    backgroundColor: "#f8f9fa",
    borderRadius: 10,
    padding: 14,
  },
  modalLocationTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2c3e50",
    marginBottom: 10,
  },
  modalLocationButton: {
    backgroundColor: "#27ae60",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  modalLocationButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },
  modalDurationContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    backgroundColor: "#f8f9fa",
    padding: 12,
    borderRadius: 8,
  },
  modalDurationText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#3498db",
    marginLeft: 8,
  },
  modalExportButton: {
    backgroundColor: "#3498db",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 24,
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  modalExportButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  noImageText: {
    fontSize: 14,
    color: "#95a5a6",
    fontStyle: "italic",
    textAlign: "center",
    backgroundColor: "#f8f9fa",
    padding: 20,
    borderRadius: 8,
  },
});
export default Reporte;
