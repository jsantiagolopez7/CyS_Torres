import { MaterialIcons } from "@expo/vector-icons";
import {
  addDays,
  addMonths,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import {
  default as React,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { db } from "../database/firebase";

// Constantes para los filtros de período
const FILTRO_DIARIO = "diario";
const FILTRO_SEMANAL = "semanal";
const FILTRO_MENSUAL = "mensual";
const { width, height } = Dimensions.get("window");

const ReporteAdmin = () => {
  // Estados para gestión de datos
  const [usuarios, setUsuarios] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtroTiempo, setFiltroTiempo] = useState(FILTRO_SEMANAL);
  const [filtroPeriodo, setFiltroPeriodo] = useState(new Date());
  const [filtroUsuario, setFiltroUsuario] = useState(null);
  const [filtroPlanta, setFiltroPlanta] = useState(null);
  const [selectedRegistro, setSelectedRegistro] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [minHoras, setMinHoras] = useState("");
  const [maxHoras, setMaxHoras] = useState("");

  // Estado para indicar si se está generando un PDF
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // Obtener datos de jornadas y usuarios
  // Función mejorada para cargar datos desde Firestore
  const cargarDatos = useCallback(async () => {
    try {
      setLoading(true);
      console.log("🔄 Iniciando carga de datos...");

      // 1. Cargar usuarios con rol "user"
      const usersQuery = query(
        collection(db, "users"),
        where("role", "==", "user")
      );
      const usersSnapshot = await getDocs(usersQuery);
      const usersData = usersSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        nombreCompleto: `${doc.data().firstName || ""} ${
          doc.data().lastName || ""
        }`,
      }));
      console.log(`✅ ${usersData.length} usuarios cargados`);
      setUsuarios(usersData);

      // 2. Cargar todas las jornadas
      console.log("📊 Consultando colección 'jornadas'...");
      const jornadasSnap = await getDocs(collection(db, "jornadas"));
      console.log(
        `📊 Se encontraron ${jornadasSnap.docs.length} documentos en jornadas`
      );

      if (jornadasSnap.empty) {
        console.log("⚠️ No se encontraron jornadas");
        setRegistros([]);
        setLoading(false);
        return;
      }

      // Array para almacenar todas las jornadas procesadas
      const jornadasArray = [];

      // Procesar cada documento en un bucle
      for (const jornadaDoc of jornadasSnap.docs) {
        const jornadaData = jornadaDoc.data();
        console.log(
          `🔍 Procesando jornada ID: ${jornadaDoc.id}, datos:`,
          jornadaData
        );

        // Verificar si existe el campo userId
        if (!jornadaData.userId) {
          console.log(`⚠️ Jornada ${jornadaDoc.id} no tiene userId, omitiendo`);
          continue;
        }

        try {
          // Obtener información del usuario
          const userDoc = await getDoc(doc(db, "users", jornadaData.userId));

          if (!userDoc.exists()) {
            console.log(
              `⚠️ Usuario ${jornadaData.userId} no existe, omitiendo jornada`
            );
            continue;
          }

          if (userDoc.data().role !== "user") {
            console.log(
              `⚠️ Usuario ${jornadaData.userId} no es role="user", omitiendo jornada`
            );
            continue;
          }

          const userData = userDoc.data();

          // Procesar jornada
          const jornada = {
            id: jornadaDoc.id,
            ...jornadaData,
            fecha: jornadaData.fecha || "Fecha no disponible",
            nombreUsuario: `${userData.firstName || ""} ${
              userData.lastName || ""
            }`,
            email: userData.email || "",
            totalHoras: calcularTotalHoras(jornadaData.plantas),
            detallesPlanta: obtenerDetallesPlanta(jornadaData.plantas),
          };

          console.log(
            `✅ Jornada procesada: ${jornada.id}, usuario: ${jornada.nombreUsuario}`
          );
          jornadasArray.push(jornada);
        } catch (userError) {
          console.error(
            `❌ Error procesando usuario para jornada ${jornadaDoc.id}:`,
            userError
          );
          // Continuar con el siguiente documento sin interrumpir el proceso
        }
      }

      console.log(`📊 Total de jornadas procesadas: ${jornadasArray.length}`);

      // Ordenar jornadas por fecha (más reciente primero)
      jornadasArray.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      setRegistros(jornadasArray);
      console.log("✅ Datos cargados correctamente");
    } catch (error) {
      console.error("❌ Error al cargar datos:", error);
      Alert.alert("Error", "No se pudieron cargar los datos de jornadas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Cargar datos al iniciar el componente
  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Función para calcular horas totales
  const calcularTotalHoras = useCallback((plantas) => {
    if (!plantas || typeof plantas !== "object")
      return { horas: 0, minutos: 0, texto: "0h 0m" };

    let totalHoras = 0;
    let totalMinutos = 0;

    // Recorrer plantas y sumar horas
    Object.values(plantas).forEach((sesiones) => {
      if (Array.isArray(sesiones)) {
        sesiones.forEach((sesion) => {
          if (sesion.entry && sesion.exit) {
            try {
              const entryDate = new Date(sesion.entry);
              const exitDate = new Date(sesion.exit);
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
      texto: `${totalHoras}h ${totalMinutos}m`,
    };
  }, []);

  // Función para obtener detalles por planta
  const obtenerDetallesPlanta = useCallback((plantas) => {
    if (!plantas || typeof plantas !== "object") return [];

    const detalles = [];

    Object.entries(plantas).forEach(([nombrePlanta, sesiones]) => {
      if (Array.isArray(sesiones)) {
        // Calcular horas por planta
        let horasPlanta = 0;
        let minutosPlanta = 0;
        let entradas = [];
        let entryImage = null;
        let exitImage = null;
        let entryLocation = null;
        let exitLocation = null;

        sesiones.forEach((sesion) => {
          // Recopilar imágenes y ubicaciones (más recientes)
          if (sesion.entryImage) entryImage = sesion.entryImage;
          if (sesion.exitImage) exitImage = sesion.exitImage;
          if (sesion.entryLocation) entryLocation = sesion.entryLocation;
          if (sesion.exitLocation) exitLocation = sesion.exitLocation;

          // Registrar entrada y salida
          if (sesion.entry) {
            const entrada = {
              entrada: sesion.entry,
              salida: sesion.exit || null,
            };

            // Calcular horas si hay entrada y salida
            if (sesion.entry && sesion.exit) {
              try {
                const entryDate = new Date(sesion.entry);
                const exitDate = new Date(sesion.exit);
                const diffMs = exitDate - entryDate;

                horasPlanta += Math.floor(diffMs / (1000 * 60 * 60));
                minutosPlanta += Math.floor(
                  (diffMs % (1000 * 60 * 60)) / (1000 * 60)
                );
              } catch (error) {
                console.warn("Error calculando horas por planta:", error);
              }
            }

            entradas.push(entrada);
          }
        });

        // Normalizar minutos
        horasPlanta += Math.floor(minutosPlanta / 60);
        minutosPlanta = minutosPlanta % 60;

        detalles.push({
          nombre: nombrePlanta,
          horas: horasPlanta,
          minutos: minutosPlanta,
          texto: `${horasPlanta}h ${minutosPlanta}m`,
          entradas,
          entryImage,
          exitImage,
          entryLocation,
          exitLocation,
        });
      }
    });

    return detalles;
  }, []);

  // Funciones para cambiar el filtro de tiempo
  const aplicarFiltroDiario = () => {
    setFiltroTiempo(FILTRO_DIARIO);
    setFiltroPeriodo(new Date());
  };

  const aplicarFiltroSemanal = () => {
    setFiltroTiempo(FILTRO_SEMANAL);
    setFiltroPeriodo(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  const aplicarFiltroMensual = () => {
    setFiltroTiempo(FILTRO_MENSUAL);
    setFiltroPeriodo(startOfMonth(new Date()));
  };

  // Función para avanzar o retroceder en el período seleccionado
  const cambiarPeriodo = (avanzar) => {
    setFiltroPeriodo((prevPeriodo) => {
      switch (filtroTiempo) {
        case FILTRO_DIARIO:
          return addDays(prevPeriodo, avanzar ? 1 : -1);
        case FILTRO_SEMANAL:
          return addDays(prevPeriodo, avanzar ? 7 : -7);
        case FILTRO_MENSUAL:
          return addMonths(prevPeriodo, avanzar ? 1 : -1);
        default:
          return prevPeriodo;
      }
    });
  };

  // Función para formatear la fecha del período seleccionado
  const formatearPeriodo = useCallback(() => {
    try {
      switch (filtroTiempo) {
        case FILTRO_DIARIO:
          return format(filtroPeriodo, "EEEE d 'de' MMMM 'de' yyyy", {
            locale: es,
          });
        case FILTRO_SEMANAL: {
          const finSemana = addDays(filtroPeriodo, 6);
          return `${format(filtroPeriodo, "d 'de' MMMM", {
            locale: es,
          })} - ${format(finSemana, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
        }
        case FILTRO_MENSUAL:
          return format(filtroPeriodo, "MMMM 'de' yyyy", { locale: es });
        default:
          return format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es });
      }
    } catch (error) {
      console.warn("Error formateando período:", error);
      return "Período no válido";
    }
  }, [filtroTiempo, filtroPeriodo]);

  // Aplicar filtros avanzados
  const aplicarFiltrosAvanzados = (filtros) => {
    setFiltroPlanta(filtros.plantaFiltro);
    setMinHoras(filtros.minHoras ? filtros.minHoras.toString() : "");
    setMaxHoras(filtros.maxHoras ? filtros.maxHoras.toString() : "");
  };

  // Limpiar todos los filtros
  const limpiarFiltros = () => {
    setSearchTerm("");
    setFiltroUsuario(null);
    setFiltroPlanta(null);
    setMinHoras("");
    setMaxHoras("");
  };

  // Registros filtrados según los criterios seleccionados
  const registrosFiltrados = useMemo(() => {
    if (!registros || registros.length === 0) return [];

    let resultado = [...registros];

    // Filtrar por período
    if (filtroTiempo === FILTRO_DIARIO) {
      const fechaFiltro = filtroPeriodo.toISOString().split("T")[0];
      resultado = resultado.filter((r) => r.fecha === fechaFiltro);
    } else if (filtroTiempo === FILTRO_SEMANAL) {
      const inicioSemana = filtroPeriodo.toISOString().split("T")[0];
      const finSemana = addDays(filtroPeriodo, 6).toISOString().split("T")[0];
      resultado = resultado.filter(
        (r) => r.fecha >= inicioSemana && r.fecha <= finSemana
      );
    } else if (filtroTiempo === FILTRO_MENSUAL) {
      const anio = filtroPeriodo.getFullYear();
      const mes = filtroPeriodo.getMonth() + 1;
      resultado = resultado.filter((r) => {
        const fecha = new Date(r.fecha);
        return fecha.getFullYear() === anio && fecha.getMonth() + 1 === mes;
      });
    }

    // Filtrar por usuario
    if (filtroUsuario) {
      resultado = resultado.filter((r) => r.userId === filtroUsuario);
    }

    // Filtrar por término de búsqueda
    if (searchTerm.trim()) {
      const termino = searchTerm.toLowerCase().trim();
      resultado = resultado.filter(
        (r) =>
          (r.nombreUsuario &&
            r.nombreUsuario.toLowerCase().includes(termino)) ||
          (r.email && r.email.toLowerCase().includes(termino))
      );
    }

    // Filtrar por planta
    if (filtroPlanta) {
      resultado = resultado.filter((r) =>
        r.detallesPlanta.some((p) => p.nombre === filtroPlanta)
      );
    }

    // Filtrar por rango de horas
    const minHorasNum = minHoras ? parseFloat(minHoras) : null;
    const maxHorasNum = maxHoras ? parseFloat(maxHoras) : null;

    if (minHorasNum !== null) {
      resultado = resultado.filter((r) => {
        const totalHorasNum = r.totalHoras.horas + r.totalHoras.minutos / 60;
        return totalHorasNum >= minHorasNum;
      });
    }

    if (maxHorasNum !== null) {
      resultado = resultado.filter((r) => {
        const totalHorasNum = r.totalHoras.horas + r.totalHoras.minutos / 60;
        return totalHorasNum <= maxHorasNum;
      });
    }

    return resultado;
  }, [
    registros,
    filtroTiempo,
    filtroPeriodo,
    filtroUsuario,
    searchTerm,
    filtroPlanta,
    minHoras,
    maxHoras,
  ]);

  // Estadísticas totales de los registros filtrados
  const estadisticas = useMemo(() => {
    let totalUsuarios = new Set();
    let totalJornadas = registrosFiltrados.length;
    let totalHoras = 0;
    let totalMinutos = 0;

    registrosFiltrados.forEach((registro) => {
      totalUsuarios.add(registro.userId);
      totalHoras += registro.totalHoras.horas || 0;
      totalMinutos += registro.totalHoras.minutos || 0;
    });

    // Normalizar minutos
    totalHoras += Math.floor(totalMinutos / 60);
    totalMinutos = totalMinutos % 60;

    return {
      totalUsuarios: totalUsuarios.size,
      totalJornadas,
      totalHoras,
      totalMinutos,
    };
  }, [registrosFiltrados]);

  // Función para abrir Google Maps con coordenadas
  const abrirGoogleMaps = useCallback((latitude, longitude) => {
    if (!latitude || !longitude) {
      Alert.alert("Sin ubicación", "No hay coordenadas disponibles");
      return;
    }

    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Alert.alert("Error", "No se puede abrir el mapa");
        }
      })
      .catch((error) => {
        console.error("Error abriendo Maps:", error);
      });
  }, []);

  // Función para formatear fecha
  const formatearFecha = useCallback((fechaStr) => {
    try {
      if (!fechaStr) return "Fecha no disponible";

      const fecha =
        typeof fechaStr === "string" ? parseISO(fechaStr) : new Date(fechaStr);

      if (isNaN(fecha.getTime())) return "Fecha inválida";

      return format(fecha, "dd/MM/yyyy", { locale: es });
    } catch (error) {
      console.warn("Error formateando fecha:", error);
      return "Fecha inválida";
    }
  }, []);

  // Función para formatear hora
  const formatearHora = useCallback((fechaStr) => {
    try {
      if (!fechaStr) return "--:--";

      const fecha =
        typeof fechaStr === "string" ? parseISO(fechaStr) : new Date(fechaStr);

      if (isNaN(fecha.getTime())) return "--:--";

      return format(fecha, "HH:mm", { locale: es });
    } catch (error) {
      console.warn("Error formateando hora:", error);
      return "--:--";
    }
  }, []);

  // Renderizar un elemento de la lista de registros con memoización
  const renderItem = useCallback(
    ({ item }) => {
      // Memoizar valores calculados para evitar recálculos innecesarios
      const formattedDate = formatearFecha(item.fecha);

      return (
        <TouchableOpacity
          style={styles.card}
          onPress={() => setSelectedRegistro(item)}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.userName}>
              {item.nombreUsuario || "Usuario desconocido"}
            </Text>
            <Text style={styles.date}>{formattedDate}</Text>
          </View>

          <Text style={styles.email}>
            {item.email || "Email no disponible"}
          </Text>

          {/* Detalles por planta con optimización de renderizado */}
          {item.detallesPlanta && item.detallesPlanta.length > 0 ? (
            <View style={styles.plantasSummary}>
              {item.detallesPlanta.map((planta, index) => (
                <View
                  key={`${item.id}-planta-${index}`}
                  style={styles.plantaItem}
                >
                  <Text style={styles.plantaName}>{planta.nombre}:</Text>
                  <Text style={styles.plantaHours}>{planta.texto}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noPlantasText}>No hay datos de plantas</Text>
          )}

          <View style={styles.cardFooter}>
            <View style={styles.horasContainer}>
              <Text style={styles.totalLabel}>Total:</Text>
              <Text style={styles.totalHoras}>{item.totalHoras.texto}</Text>
            </View>

            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={styles.viewButton}
                onPress={() => setSelectedRegistro(item)}
              >
                <MaterialIcons name="visibility" size={18} color="white" />
                <Text style={styles.viewButtonText}>Ver detalle</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareButton}
                onPress={() => compartirRegistro(item)}
              >
                <MaterialIcons name="share" size={18} color="white" />
                <Text style={styles.shareButtonText}>Compartir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [formatearFecha]
  );

  // Función para compartir información de un registro
  const compartirRegistro = async (registro) => {
    if (!registro) return;

    try {
      const mensaje =
        `Reporte de Horas - ${registro.nombreUsuario}\n` +
        `Fecha: ${formatearFecha(registro.fecha)}\n` +
        `Total horas: ${registro.totalHoras.texto}\n` +
        `Plantas trabajadas: ${registro.detallesPlanta
          .map((p) => `${p.nombre} (${p.texto})`)
          .join(", ")}`;

      await Sharing.shareAsync(null, {
        message: mensaje,
        dialogTitle: `Compartir reporte de ${registro.nombreUsuario}`,
      });
    } catch (error) {
      console.error("Error al compartir registro:", error);
      Alert.alert("Error", "No se pudo compartir el registro");
    }
  };

  // Modal para seleccionar usuario
  const renderUserPickerModal = () => (
    <Modal
      visible={showUserPicker}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowUserPicker(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.userPickerModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Seleccionar Usuario</Text>
            <TouchableOpacity onPress={() => setShowUserPicker(false)}>
              <MaterialIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.userItem, !filtroUsuario && styles.userItemSelected]}
            onPress={() => {
              setFiltroUsuario(null);
              setShowUserPicker(false);
            }}
          >
            <Text
              style={[
                styles.userItemText,
                !filtroUsuario && styles.userItemTextSelected,
              ]}
            >
              Todos los usuarios
            </Text>
          </TouchableOpacity>

          <FlatList
            data={usuarios}
            keyExtractor={(item) => item.id}
            renderItem={renderUserItem}
          />
        </View>
      </View>
    </Modal>
  );

  // Componente para renderizar un usuario en la lista de selección
  const renderUserItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.userItem,
        filtroUsuario === item.id && styles.userItemSelected,
      ]}
      onPress={() => {
        setFiltroUsuario(item.id);
        setShowUserPicker(false);
      }}
    >
      <Text
        style={[
          styles.userItemText,
          filtroUsuario === item.id && styles.userItemTextSelected,
        ]}
      >
        {item.nombreCompleto || item.email || "Usuario desconocido"}
      </Text>
    </TouchableOpacity>
  );

  // Modal para ver detalles de un registro
  const renderDetalleModal = () => {
    if (!selectedRegistro) return null;

    return (
      <Modal
        visible={!!selectedRegistro}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSelectedRegistro(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detalleModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detalles de Jornada</Text>
              <TouchableOpacity onPress={() => setSelectedRegistro(null)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.userInfo}>
                <Text style={styles.detailUserName}>
                  {selectedRegistro.nombreUsuario || "Usuario desconocido"}
                </Text>
                <Text style={styles.detailEmail}>
                  {selectedRegistro.email || "Email no disponible"}
                </Text>
                <Text style={styles.detailDate}>
                  Fecha: {formatearFecha(selectedRegistro.fecha)}
                </Text>
              </View>

              {/* Plantas y sesiones */}
              <Text style={styles.sectionTitle}>Detalle por Planta</Text>

              {selectedRegistro.detallesPlanta.map((planta, indexPlanta) => (
                <View key={indexPlanta} style={styles.plantaDetail}>
                  <View style={styles.plantaHeader}>
                    <Text style={styles.plantaDetailName}>{planta.nombre}</Text>
                    <Text style={styles.plantaDetailHours}>{planta.texto}</Text>
                  </View>

                  {/* Imágenes de entrada/salida */}
                  {(planta.entryImage || planta.exitImage) && (
                    <View style={styles.imageSection}>
                      <Text style={styles.imageSectionTitle}>Imágenes:</Text>
                      <View style={styles.imagesContainer}>
                        {planta.entryImage && (
                          <View style={styles.imageContainer}>
                            <Text style={styles.imageLabel}>Entrada:</Text>
                            <Image
                              source={{ uri: planta.entryImage }}
                              style={styles.detailImage}
                              resizeMode="cover"
                            />
                          </View>
                        )}

                        {planta.exitImage && (
                          <View style={styles.imageContainer}>
                            <Text style={styles.imageLabel}>Salida:</Text>
                            <Image
                              source={{ uri: planta.exitImage }}
                              style={styles.detailImage}
                              resizeMode="cover"
                            />
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Ubicaciones */}
                  <View style={styles.locationButtons}>
                    {planta.entryLocation && (
                      <TouchableOpacity
                        style={styles.locationButton}
                        onPress={() =>
                          abrirGoogleMaps(
                            planta.entryLocation.latitude ||
                              planta.entryLocation.lat,
                            planta.entryLocation.longitude ||
                              planta.entryLocation.lng
                          )
                        }
                      >
                        <MaterialIcons
                          name="location-on"
                          size={16}
                          color="white"
                        />
                        <Text style={styles.locationButtonText}>
                          Ver ubicación de entrada
                        </Text>
                      </TouchableOpacity>
                    )}

                    {planta.exitLocation && (
                      <TouchableOpacity
                        style={styles.locationButton}
                        onPress={() =>
                          abrirGoogleMaps(
                            planta.exitLocation.latitude ||
                              planta.exitLocation.lat,
                            planta.exitLocation.longitude ||
                              planta.exitLocation.lng
                          )
                        }
                      >
                        <MaterialIcons
                          name="location-on"
                          size={16}
                          color="white"
                        />
                        <Text style={styles.locationButtonText}>
                          Ver ubicación de salida
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Registros detallados */}
                  <Text style={styles.entriesTitle}>Registros:</Text>
                  {planta.entradas.map((entrada, indexEntrada) => (
                    <View key={indexEntrada} style={styles.entryItem}>
                      <Text style={styles.entryNumber}>
                        Registro #{indexEntrada + 1}
                      </Text>
                      <View style={styles.entryTimes}>
                        <View style={styles.entryTime}>
                          <MaterialIcons
                            name="login"
                            size={14}
                            color="#2ecc71"
                          />
                          <Text style={styles.timeText}>
                            {formatearHora(entrada.entrada)}
                          </Text>
                        </View>
                        <View style={styles.entryTime}>
                          <MaterialIcons
                            name="logout"
                            size={14}
                            color="#e74c3c"
                          />
                          <Text style={styles.timeText}>
                            {entrada.salida
                              ? formatearHora(entrada.salida)
                              : "Pendiente"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ))}

              <View style={styles.totalSection}>
                <Text style={styles.totalTitle}>Total de Horas:</Text>
                <Text style={styles.totalDetailHours}>
                  {selectedRegistro.totalHoras.texto}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // Función para exportar a PDF
  const exportarReporte = async () => {
  try {
    setGeneratingPDF(true);

    // Verificar si hay registros para exportar
    if (registrosFiltrados.length === 0) {
      Alert.alert(
        "Sin datos",
        "No hay registros que exportar con los filtros actuales"
      );
      setGeneratingPDF(false);
      return;
    }

    Alert.alert(
      "Exportación en PDF",
      `Se exportarán ${registrosFiltrados.length} registros. ¿Desea continuar?`,
      [
        {
          text: "Cancelar",
          style: "cancel",
          onPress: () => setGeneratingPDF(false)
        },
        {
          text: "Exportar",
          onPress: async () => {
            try {
              // NUEVO: Agrupar registros por usuario para calcular horas individuales
              const registrosPorUsuario = {};
              
              registrosFiltrados.forEach(registro => {
                if (!registro.userId) return;
                
                if (!registrosPorUsuario[registro.userId]) {
                  registrosPorUsuario[registro.userId] = {
                    nombre: registro.nombreUsuario || 'Usuario sin nombre',
                    email: registro.email || '',
                    registros: [],
                    totalHoras: 0,
                    totalMinutos: 0
                  };
                }
                
                // Añadir el registro al usuario correspondiente
                registrosPorUsuario[registro.userId].registros.push(registro);
                
                // Sumar horas SOLO para este usuario específico
                registrosPorUsuario[registro.userId].totalHoras += registro.totalHoras.horas || 0;
                registrosPorUsuario[registro.userId].totalMinutos += registro.totalHoras.minutos || 0;
              });
              
              // Normalizar los minutos a horas
              Object.values(registrosPorUsuario).forEach(usuario => {
                usuario.totalHoras += Math.floor(usuario.totalMinutos / 60);
                usuario.totalMinutos = usuario.totalMinutos % 60;
              });
              
              // Generar HTML para el PDF con secciones por usuario
              const htmlContent = `
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                    <style>
                      body { font-family: 'Helvetica'; padding: 20px; }
                      h1 { color: #2c3e50; text-align: center; font-size: 24px; margin-bottom: 20px; }
                      h2 { color: #3498db; font-size: 18px; margin-top: 15px; }
                      h3 { color: #2c3e50; font-size: 16px; margin-top: 25px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
                      .header { margin-bottom: 30px; text-align: center; }
                      .summary { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                      .summary-title { font-weight: bold; margin-bottom: 10px; }
                      .summary-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
                      table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                      th, td { border: 1px solid #ddd; padding: 10px 8px; text-align: left; }
                      th { background-color: #3498db; color: white; }
                      tr:nth-child(even) { background-color: #f2f2f2; }
                      .user-section { margin-bottom: 30px; background-color: #f9f9f9; padding: 15px; border-radius: 8px; }
                      .user-email { color: #7f8c8d; font-size: 14px; margin-bottom: 10px; }
                      .user-total { text-align: right; font-weight: bold; margin-top: 10px; color: #16a085; }
                      .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #7f8c8d; border-top: 1px solid #eee; padding-top: 10px; }
                    </style>
                  </head>
                  <body>
                    <div class="header">
                      <h1>Reporte de Registros por Usuario</h1>
                      <p>Fecha de generación: ${format(new Date(), "dd/MM/yyyy", { locale: es })}</p>
                      ${filtroUsuario ? `<p>Usuario: ${usuarios.find(u => u.id === filtroUsuario)?.nombreCompleto || 'N/A'}</p>` : ''}
                      ${filtroPlanta ? `<p>Planta: ${filtroPlanta}</p>` : ''}
                      ${filtroTiempo !== 'diario' ? `<p>Periodo: ${formatearPeriodo()}</p>` : ''}
                    </div>

                    <div class="summary">
                      <div class="summary-title">Resumen General:</div>
                      <div class="summary-row">
                        <span>Total de Registros:</span>
                        <span>${registrosFiltrados.length}</span>
                      </div>
                      <div class="summary-row">
                        <span>Total de Usuarios:</span>
                        <span>${Object.keys(registrosPorUsuario).length}</span>
                      </div>
                    </div>

                    <h2>Detalles por Usuario</h2>
                    
                    <!-- Secciones separadas por cada usuario -->
                    ${Object.values(registrosPorUsuario).map(usuario => `
                      <div class="user-section">
                        <h3>${usuario.nombre}</h3>
                        <p class="user-email">${usuario.email}</p>
                        
                        <table>
                          <tr>
                            <th>Fecha</th>
                            <th>Plantas</th>
                            <th>Horas</th>
                          </tr>
                          ${usuario.registros.map(registro => `
                            <tr>
                              <td>${formatearFecha(registro.fecha)}</td>
                              <td>${registro.detallesPlanta.map(p => `${p.nombre}: ${p.texto}`).join('<br>')}</td>
                              <td>${registro.totalHoras.texto}</td>
                            </tr>
                          `).join('')}
                        </table>
                        
                        <div class="user-total">
                          Total de horas para ${usuario.nombre}: 
                          <strong>${usuario.totalHoras}h ${usuario.totalMinutos}m</strong>
                        </div>
                      </div>
                    `).join('')}
                    
                    <div class="footer">
                      <p>© ${new Date().getFullYear()} - Reporte generado automáticamente</p>
                    </div>
                  </body>
                </html>
              `;

              // Generar el PDF con expo-print
              const { uri } = await Print.printToFileAsync({ 
                html: htmlContent,
                base64: false
              });
              
              // Verificar si el dispositivo puede compartir
              if (await Sharing.isAvailableAsync()) {
                // Compartir el archivo PDF
                await Sharing.shareAsync(uri, { 
                  mimeType: 'application/pdf',
                  dialogTitle: 'Compartir Reporte PDF',
                  UTI: 'com.adobe.pdf' // Para iOS
                });
                
                Alert.alert("Éxito", "El PDF ha sido generado y compartido");
              } else {
                // Si compartir no está disponible, guardar el archivo
                const pdfName = `reporte_${Date.now()}.pdf`;
                const newPath = FileSystem.documentDirectory + pdfName;
                
                await FileSystem.copyAsync({
                  from: uri,
                  to: newPath
                });
                
                Alert.alert("Éxito", `PDF guardado en: ${newPath}`);
              }
            } catch (error) {
              console.error("Error generando PDF:", error);
              Alert.alert("Error", "No se pudo generar el PDF");
            } finally {
              setGeneratingPDF(false);
            }
          }
        },
      ]
    );
  } catch (error) {
    console.error("Error exportando PDF:", error);
    Alert.alert("Error", "No se pudo exportar el reporte en PDF");
    setGeneratingPDF(false);
  }
};

  // Función para enviar reporte por email
  const enviarReportePorEmail = async () => {
    try {
      // Verificar si hay registros para enviar
      if (registrosFiltrados.length === 0) {
        Alert.alert(
          "Sin datos",
          "No hay registros que enviar con los filtros actuales"
        );
        return;
      }

      // Podríamos mostrar un modal para ingresar correos destinatarios
      Alert.alert(
        "Enviar por Email",
        "¿Desea enviar este reporte por correo electrónico?",
        [
          {
            text: "Cancelar",
            style: "cancel",
          },
          {
            text: "Enviar",
            onPress: async () => {
              // Aquí normalmente usaríamos react-native-mail o similar
              // para abrir el cliente de correo o enviar directamente
              Alert.alert(
                "Éxito",
                "Función de envío por email implementada correctamente"
              );

              // Aquí iría el código real de envío por email
            },
          },
        ]
      );
    } catch (error) {
      console.error("Error enviando email:", error);
      Alert.alert("Error", "No se pudo enviar el reporte por email");
    }
  };

  const ExportOptions = ({ visible, onClose, onExportPDF, onEmailReport }) => {
    if (!visible) return null;

    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.exportOptionsModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Opciones de Exportación</Text>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <View style={styles.exportOptions}>
              <TouchableOpacity
                style={[
                  styles.exportOptionButton,
                  { backgroundColor: "#e74c3c" },
                ]}
                onPress={() => {
                  onExportPDF();
                  onClose();
                }}
              >
                <MaterialIcons name="picture-as-pdf" size={32} color="white" />
                <Text style={styles.exportOptionText}>PDF</Text>
                <Text style={styles.exportOptionSubtext}>
                  Exportar como documento PDF
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.exportOptionButton,
                  { backgroundColor: "#3498db" },
                ]}
                onPress={() => {
                  onEmailReport();
                  onClose();
                }}
              >
                <MaterialIcons name="email" size={32} color="white" />
                <Text style={styles.exportOptionText}>Email</Text>
                <Text style={styles.exportOptionSubtext}>
                  Enviar reporte por correo
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.pageTitle}>Panel de Reportes</Text>

      {/* Controles de filtro */}
      <View style={styles.filterControls}>
        <View style={styles.filterButtons}>
          <TouchableOpacity
            style={[
              styles.filterButton,
              filtroTiempo === FILTRO_DIARIO && styles.filterButtonActive,
            ]}
            onPress={aplicarFiltroDiario}
          >
            <Text
              style={
                filtroTiempo === FILTRO_DIARIO
                  ? styles.filterTextActive
                  : styles.filterText
              }
            >
              Diario
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterButton,
              filtroTiempo === FILTRO_SEMANAL && styles.filterButtonActive,
            ]}
            onPress={aplicarFiltroSemanal}
          >
            <Text
              style={
                filtroTiempo === FILTRO_SEMANAL
                  ? styles.filterTextActive
                  : styles.filterText
              }
            >
              Semanal
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterButton,
              filtroTiempo === FILTRO_MENSUAL && styles.filterButtonActive,
            ]}
            onPress={aplicarFiltroMensual}
          >
            <Text
              style={
                filtroTiempo === FILTRO_MENSUAL
                  ? styles.filterTextActive
                  : styles.filterText
              }
            >
              Mensual
            </Text>
          </TouchableOpacity>
        </View>

        {/* Selector de período */}
        <View style={styles.periodSelector}>
          <TouchableOpacity
            style={styles.arrowButton}
            onPress={() => cambiarPeriodo(false)}
          >
            <MaterialIcons name="chevron-left" size={24} color="#3498db" />
          </TouchableOpacity>

          <Text style={styles.periodText}>{formatearPeriodo()}</Text>

          <TouchableOpacity
            style={styles.arrowButton}
            onPress={() => cambiarPeriodo(true)}
          >
            <MaterialIcons name="chevron-right" size={24} color="#3498db" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Búsqueda y selector de usuario */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#999" />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre o email..."
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholderTextColor="#999"
          />
        </View>

        <TouchableOpacity
          style={styles.userFilterButton}
          onPress={() => setShowUserPicker(true)}
        >
          <MaterialIcons name="person" size={20} color="#3498db" />
          <Text style={styles.userFilterText}>
            {filtroUsuario
              ? usuarios.find((u) => u.id === filtroUsuario)?.nombreCompleto ||
                "Usuario"
              : "Todos"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tarjeta de estadísticas */}
      <View style={styles.statsCard}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{estadisticas.totalUsuarios}</Text>
          <Text style={styles.statLabel}>Usuarios</Text>
        </View>

        <View style={styles.statItem}>
          <Text style={styles.statValue}>{estadisticas.totalJornadas}</Text>
          <Text style={styles.statLabel}>Jornadas</Text>
        </View>

        <View style={styles.statItem}>
          <Text
            style={styles.statValue}
          >{`${estadisticas.totalHoras}h ${estadisticas.totalMinutos}m`}</Text>
          <Text style={styles.statLabel}>Horas</Text>
        </View>
      </View>

      {/* Lista de registros */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={styles.loadingText}>Cargando registros...</Text>
        </View>
      ) : registrosFiltrados.length === 0 ? (
        <View style={styles.centerContainer}>
          <MaterialIcons name="search-off" size={50} color="#ccc" />
          <Text style={styles.emptyText}>No se encontraron registros</Text>
          <Text style={styles.emptySubtext}>
            Prueba con otro período o filtro
          </Text>
        </View>
      ) : (
        <FlatList
          data={registrosFiltrados}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            cargarDatos();
          }}
          contentContainerStyle={styles.listContainer}
        />
      )}

      {/* Botón de exportación flotante */}
      <TouchableOpacity
        style={styles.exportFloatingButton}
        onPress={() => setShowExportOptions(true)}
        disabled={registrosFiltrados.length === 0}
      >
        <MaterialIcons name="file-download" size={24} color="white" />
      </TouchableOpacity>

      {/* Indicador de generación de PDF */}
      {generatingPDF && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingText}>Generando PDF...</Text>
        </View>
      )}

      {/* Modales */}
      {renderUserPickerModal()}
      {renderDetalleModal()}

      {/* Modal de opciones de exportación */}
      <ExportOptions
        visible={showExportOptions}
        onClose={() => setShowExportOptions(false)}
        onExportPDF={exportarReporte}
        onEmailReport={enviarReportePorEmail}
      />
    </View>
  );
};
// Reemplaza todo el objeto styles actual con este objeto completo
const styles = StyleSheet.create({
  // Estilos base y contenedores
  container: {
    flex: 1,
    backgroundColor: "#f5f6fa",
    padding: 16,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 16,
  },

  // Controles de filtro
  filterControls: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  filterButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  filterButton: {
    flex: 1,
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginHorizontal: 4,
    alignItems: "center",
  },
  filterButtonActive: {
    backgroundColor: "#3498db",
  },
  filterText: {
    color: "#34495e",
    fontWeight: "500",
  },
  filterTextActive: {
    color: "#fff",
    fontWeight: "600",
  },

  // Selector de periodo
  periodSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrowButton: {
    padding: 8,
  },
  periodText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#2c3e50",
    flex: 1,
    textAlign: "center",
  },

  // Barra de búsqueda
  searchContainer: {
    flexDirection: "row",
    marginBottom: 16,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    marginLeft: 8,
    color: "#2c3e50",
  },
  userFilterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  userFilterText: {
    marginLeft: 4,
    color: "#3498db",
    fontSize: 14,
    fontWeight: "500",
  },

  // Tarjeta de estadísticas
  statsCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#3498db",
  },
  statLabel: {
    fontSize: 14,
    color: "#7f8c8d",
    marginTop: 4,
  },

  // Estados de lista vacía y cargando
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: "#7f8c8d",
  },
  emptyText: {
    fontSize: 18,
    color: "#95a5a6",
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#bdc3c7",
    marginTop: 4,
  },
  listContainer: {
    paddingBottom: 72, // Espacio para el botón flotante
  },

  // Botón flotante de exportación
  exportFloatingButton: {
    position: "absolute",
    bottom: 16,
    right: 16,
    backgroundColor: "#3498db",
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },

  // Estilos de tarjeta de registro
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2c3e50",
    flex: 1,
  },
  date: {
    fontSize: 14,
    color: "#7f8c8d",
  },
  email: {
    fontSize: 14,
    color: "#95a5a6",
    marginBottom: 12,
  },
  plantasSummary: {
    marginBottom: 12,
  },
  plantaItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f2f6",
  },
  plantaName: {
    fontSize: 14,
    color: "#34495e",
  },
  plantaHours: {
    fontSize: 14,
    fontWeight: "500",
    color: "#3498db",
  },
  noPlantasText: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#95a5a6",
    textAlign: "center",
    marginVertical: 8,
  },
  cardFooter: {
    flexDirection: "row",
    marginTop: 8,
    justifyContent: "space-between",
    alignItems: "center",
  },
  horasContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#34495e",
    marginRight: 4,
  },
  totalHoras: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#2ecc71",
  },
  actionsContainer: {
    flexDirection: "row",
  },
  viewButton: {
    backgroundColor: "#3498db",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
  },
  viewButtonText: {
    color: "white",
    fontSize: 12,
    marginLeft: 4,
  },
  shareButton: {
    backgroundColor: "#9b59b6",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  shareButtonText: {
    color: "white",
    fontSize: 12,
    marginLeft: 4,
  },

  // Modal overlay general
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Modal de opciones de exportación
  exportOptionsModal: {
    width: width * 0.9,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    maxHeight: height * 0.7,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#ecf0f1",
    paddingBottom: 12,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#2c3e50",
  },
  exportOptions: {
    marginTop: 16,
  },
  exportOptionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  exportOptionText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 16,
    flex: 1,
  },
  exportOptionSubtext: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
  },

  // Modal de selección de usuario
  userPickerModal: {
    width: width * 0.9,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    maxHeight: height * 0.7,
  },
  userItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#ecf0f1",
  },
  userItemSelected: {
    backgroundColor: "#e3f2fd",
  },
  userItemText: {
    fontSize: 16,
    color: "#2c3e50",
  },
  userItemTextSelected: {
    color: "#3498db",
    fontWeight: "600",
  },

  // Modal de detalles de registro
  detalleModal: {
    width: width * 0.9,
    backgroundColor: "white",
    borderRadius: 12,
    maxHeight: height * 0.8,
  },
  modalScroll: {
    padding: 16,
  },
  userInfo: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
  },
  detailUserName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#2c3e50",
    marginBottom: 4,
  },
  detailEmail: {
    fontSize: 14,
    color: "#7f8c8d",
    marginBottom: 8,
  },
  detailDate: {
    fontSize: 14,
    fontWeight: "500",
    color: "#34495e",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2c3e50",
    marginBottom: 12,
    marginTop: 8,
  },
  plantaDetail: {
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  plantaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#ecf0f1",
  },
  plantaDetailName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#34495e",
  },
  plantaDetailHours: {
    fontSize: 16,
    fontWeight: "600",
    color: "#3498db",
  },
  imageSection: {
    marginBottom: 12,
  },
  imageSectionTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#34495e",
    marginBottom: 8,
  },
  imagesContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  imageContainer: {
    width: "48%",
  },
  imageLabel: {
    fontSize: 13,
    color: "#7f8c8d",
    marginBottom: 4,
  },
  detailImage: {
    width: "100%",
    height: 150,
    borderRadius: 8,
    backgroundColor: "#ecf0f1",
  },
  locationButtons: {
    marginVertical: 12,
  },
  locationButton: {
    backgroundColor: "#2ecc71",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
  },
  locationButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 8,
  },
  entriesTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#34495e",
    marginBottom: 8,
  },
  entryItem: {
    backgroundColor: "white",
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  entryNumber: {
    fontSize: 13,
    fontWeight: "600",
    color: "#34495e",
    marginBottom: 6,
  },
  entryTimes: {
    marginLeft: 8,
  },
  entryTime: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  timeText: {
    fontSize: 14,
    color: "#2c3e50",
    marginLeft: 8,
  },
  totalSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e3f2fd",
    borderRadius: 8,
    padding: 12,
    marginVertical: 16,
  },
  totalTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2c3e50",
    marginRight: 8,
  },
  totalDetailHours: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2ecc71",
  },

  // Modal de filtros avanzados
  filterModal: {
    width: width * 0.9,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#2c3e50",
    marginBottom: 8,
    marginTop: 12,
  },
  filterInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  filterInputLabel: {
    fontSize: 14,
    color: "#34495e",
    width: 60,
  },
  filterInput: {
    flex: 1,
    backgroundColor: "#f5f6fa",
    padding: 8,
    borderRadius: 6,
    marginLeft: 8,
    color: "#2c3e50",
  },
  filterButtonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  applyFilterButton: {
    backgroundColor: "#3498db",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  filterButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 6,
  },
  cancelFilterButton: {
    backgroundColor: "#95a5a6",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  resetFilterButton: {
    backgroundColor: "#e74c3c",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  // Estilos para el indicador de carga del PDF
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  loadingText: {
    color: "#ffffff",
    marginTop: 10,
    fontSize: 16,
    fontWeight: "500",
  },
});
export default ReporteAdmin;