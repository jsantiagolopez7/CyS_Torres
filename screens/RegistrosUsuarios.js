import { MaterialIcons } from "@expo/vector-icons";
import { useRoute } from "@react-navigation/native";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { db } from "../database/firebase";

const RegistrosUsuarios = () => {
  // Estados para gestión de datos
  const route = useRoute();
  const [highlightedJornadaId, setHighlightedJornadaId] = useState(null);
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedRegistro, setSelectedRegistro] = useState(null);
  const [userFilter, setUserFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState(null);
  const [plantFilter, setPlantFilter] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [fechas, setFechas] = useState([]);

  // Cargar registros en tiempo real con Firestore onSnapshot
  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true);

      try {
        // Cargar usuarios
        const usersSnapshot = await getDocs(collection(db, "users"));
        const usersData = usersSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          nombreCompleto: `${doc.data().firstName || ""} ${
            doc.data().lastName || ""
          }`,
        }));

        setUsuarios(usersData.filter((user) => user.role === "user"));
      } catch (error) {
        console.error("Error al cargar usuarios:", error);
        Alert.alert("Error", "No se pudieron cargar los usuarios");
      }

      setLoading(false);
    };

    loadAllData();

    // Listener para jornadas completas
    const unsubscribeJornadas = onSnapshot(
      collection(db, "jornadas"),
      async (snapshot) => {
        try {
          let registrosData = [];
          let fechasUnicas = new Set();

          for (const docSnapshot of snapshot.docs) {
            const jornada = { id: docSnapshot.id, ...docSnapshot.data() };

            if (jornada.fecha) {
              fechasUnicas.add(jornada.fecha);
            }

            if (jornada.userId) {
              const userDoc = await getDoc(doc(db, "users", jornada.userId));

              if (userDoc.exists() && userDoc.data().role === "user") {
                const userData = userDoc.data();
                jornada.nombreUsuario = `${userData.firstName || ""} ${
                  userData.lastName || ""
                }`;
                jornada.email = userData.email || "";

                const plantasData = procesarPlantasJornada(jornada.plantas);

                registrosData.push({
                  ...jornada,
                  ...plantasData,
                  fecha: jornada.fecha || formatDate(new Date()),
                  totalHoras:
                    calcularHorasTrabajadas(jornada.plantas) || "0h 0m",
                  tipoRegistro: "jornada",
                });
              }
            }
          }

          registrosData.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          setRegistros(registrosData);
          setFechas(Array.from(fechasUnicas).sort().reverse());
        } catch (error) {
          console.error("Error procesando jornadas:", error);
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      }
    );

    // Listener para entradas en tiempo real
    const unsubscribeEntradas = onSnapshot(
      collection(db, "entradasNotificaciones"),
      async (snapshot) => {
        try {
          if (!snapshot.empty) {
            const currentRegistros = [...registros];
            const entryIdsMap = new Map(
              currentRegistros.map((r) => [r.id, true])
            );
            let hasNewEntries = false;
            let fechasUnicas = new Set(fechas);

            for (const docSnapshot of snapshot.docs) {
              if (!entryIdsMap.has(docSnapshot.id)) {
                const entryData = docSnapshot.data();
                const entryTime = new Date(
                  entryData.timestamp || entryData.createdAt
                );

                if ((new Date() - entryTime) / (1000 * 60 * 60) <= 24) {
                  const userDoc = await getDoc(
                    doc(db, "users", entryData.userId)
                  );

                  if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const entryRegistro = {
                      id: docSnapshot.id,
                      userId: entryData.userId,
                      nombreUsuario: `${userData.firstName || ""} ${
                        userData.lastName || ""
                      }`,
                      email: userData.email || "",
                      fecha: entryTime.toISOString().split("T")[0],
                      planta: entryData.planta || "Planta sin especificar",
                      entryImage: entryData.imagenUrl,
                      entryLocation: entryData.location,
                      tipoRegistro: "entrada",
                      timestamp: entryData.timestamp || entryData.createdAt,
                      plantas: [
                        {
                          nombre: entryData.planta || "Planta sin especificar",
                          sesiones: [{ entry: entryData.timestamp }],
                        },
                      ],
                    };

                    currentRegistros.unshift(entryRegistro);
                    entryIdsMap.set(docSnapshot.id, true);
                    hasNewEntries = true;
                    fechasUnicas.add(entryRegistro.fecha);
                  }
                }
              }
            }

            if (hasNewEntries) {
              currentRegistros.sort((a, b) => {
                const dateA = a.timestamp ? new Date(a.timestamp) : new Date(0);
                const dateB = b.timestamp ? new Date(b.timestamp) : new Date(0);
                return dateB - dateA;
              });

              setRegistros(currentRegistros);
              setFechas(Array.from(fechasUnicas).sort().reverse());
            }
          }
        } catch (error) {
          console.error("Error procesando entradas:", error);
        }
      }
    );

    return () => {
      unsubscribeJornadas();
      unsubscribeEntradas();
    };
  }, []);

  useEffect(() => {
    if (route.params?.highlightedJornadaId) {
      setHighlightedJornadaId(route.params.highlightedJornadaId);

      // Si hay filtros preestablecidos, aplicarlos
      if (route.params.userId) {
        setUserFilter(route.params.userId);
      }
      if (route.params.fecha) {
        setDateFilter(route.params.fecha);
      }
    }

    // Para notificaciones de entrada
    if (route.params?.filtroUsuarioId) {
      setUserFilter(route.params.filtroUsuarioId);
    }
    if (route.params?.planta) {
      setPlantFilter(route.params.planta);
    }
  }, [route.params]);

  // Función para procesar los datos de plantas en una jornada
  const procesarPlantasJornada = useCallback((plantas) => {
    if (!plantas || typeof plantas !== "object") {
      return {
        entryImage: null,
        exitImage: null,
        entryLocation: null,
        exitLocation: null,
        plantas: [],
      };
    }

    let entryImage = null;
    let exitImage = null;
    let entryLocation = null;
    let exitLocation = null;
    const plantasInfo = [];

    // Recorrer cada planta y sus sesiones
    Object.entries(plantas).forEach(([nombrePlanta, sesiones]) => {
      if (Array.isArray(sesiones)) {
        let totalHorasPlanta = 0;
        let totalMinutosPlanta = 0;

        // Para cada sesión en la planta
        sesiones.forEach((sesion) => {
          // Capturar imágenes y ubicaciones (priorizar las últimas)
          if (sesion.entryImage) entryImage = sesion.entryImage;
          if (sesion.exitImage) exitImage = sesion.exitImage;

          if (sesion.entryLocation) entryLocation = sesion.entryLocation;
          if (sesion.exitLocation) exitLocation = sesion.exitLocation;

          // Si no hay entryLocation pero hay location en coordenadas, usarlo
          if (!entryLocation && sesion.location) {
            entryLocation = {
              latitude: sesion.location.latitude || sesion.location.lat,
              longitude: sesion.location.longitude || sesion.location.lng,
            };
          }

          // Calcular horas si hay entrada y salida
          if (sesion.entry && sesion.exit) {
            try {
              const entryDate = new Date(sesion.entry);
              const exitDate = new Date(sesion.exit);
              const diffMs = exitDate - entryDate;

              totalHorasPlanta += Math.floor(diffMs / (1000 * 60 * 60));
              totalMinutosPlanta += Math.floor(
                (diffMs % (1000 * 60 * 60)) / (1000 * 60)
              );
            } catch (error) {
              console.warn("Error calculando horas:", error);
            }
          }
        });

        // Normalizar minutos (convertir exceso a horas)
        totalHorasPlanta += Math.floor(totalMinutosPlanta / 60);
        totalMinutosPlanta = totalMinutosPlanta % 60;

        // Agregar información de esta planta
        plantasInfo.push({
          nombre: nombrePlanta,
          sesiones: sesiones,
          totalHoras: `${totalHorasPlanta}h ${totalMinutosPlanta}m`,
          horasNumero: totalHorasPlanta + totalMinutosPlanta / 60,
        });
      }
    });

    return {
      entryImage,
      exitImage,
      entryLocation,
      exitLocation,
      plantas: plantasInfo,
    };
  }, []);

  // Función para calcular horas trabajadas
  const calcularHorasTrabajadas = useCallback((plantas) => {
    if (!plantas || typeof plantas !== "object") return "0h 0m";

    let totalHoras = 0;
    let totalMinutos = 0;

    // Recorrer plantas y sumar horas trabajadas
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

    return `${totalHoras}h ${totalMinutos}m`;
  }, []);

  // Función para eliminar un registro (solo admin)
  const eliminarRegistro = useCallback(async (registroId) => {
    Alert.alert(
      "Confirmar eliminación",
      "¿Está seguro de eliminar este registro? Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await deleteDoc(doc(db, "jornadas", registroId));
              Alert.alert("Éxito", "Registro eliminado correctamente");
            } catch (error) {
              console.error("Error eliminando registro:", error);
              Alert.alert("Error", "No se pudo eliminar el registro");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, []);

  // Función para abrir Google Maps con las coordenadas
  const abrirGoogleMaps = useCallback((latitude, longitude) => {
    if (!latitude || !longitude) {
      Alert.alert(
        "Ubicación no disponible",
        "No se encontraron coordenadas válidas"
      );
      return;
    }

    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Alert.alert("Error", "No se pudo abrir Google Maps");
        }
      })
      .catch((error) => {
        console.error("Error abriendo Maps:", error);
        Alert.alert("Error", "No se pudo abrir el mapa");
      });
  }, []);

  // Formatear fecha para mostrar
  const formatDate = useCallback((date) => {
    if (!date) return "Fecha desconocida";

    if (typeof date === "string") {
      date = new Date(date);
    }

    if (isNaN(date.getTime())) {
      return "Fecha inválida";
    }

    return date.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }, []);

  // Formatear hora para mostrar
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


  // Filtrar registros según los criterios actuales
  const registrosFiltrados = registros.filter((item) => {
    // Filtrar por texto de búsqueda (en nombre o email)
    const matchesSearch =
      search.trim() === "" ||
      item.nombreUsuario?.toLowerCase().includes(search.toLowerCase()) ||
      item.email?.toLowerCase().includes(search.toLowerCase());

    // Filtrar por usuario seleccionado
    const matchesUser = !userFilter || item.userId === userFilter;

    // Filtrar por fecha
    const matchesDate = !dateFilter || item.fecha === dateFilter;

    // Filtrar por planta
    const matchesPlant =
      !plantFilter || item.plantas?.some((p) => p.nombre === plantFilter);

    // Combinar todos los filtros
    return matchesSearch && matchesUser && matchesDate && matchesPlant;
  });

  // Componente para renderizar imágenes con manejo de errores
  const RenderImage = useCallback(({ label, imageUri }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    return (
      <View style={styles.imageWrapper}>
        <Text style={styles.imageLabel}>{label}</Text>

        {loading && !error && imageUri && (
          <ActivityIndicator size="small" color="#007AFF" />
        )}

        {imageUri && !error ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
        ) : (
          <View style={styles.noImageContainer}>
            <MaterialIcons name="image-not-supported" size={24} color="#999" />
            <Text style={styles.noImageText}>Sin imagen</Text>
          </View>
        )}
      </View>
    );
  }, []);

  // Limpiar todos los filtros
  const limpiarFiltros = useCallback(() => {
    setSearch("");
    setUserFilter(null);
    setDateFilter(null);
    setPlantFilter(null);
  }, []);

  // Manejador de pull-to-refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // La actualización ocurrirá automáticamente por el onSnapshot
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Registros de Usuarios</Text>

      {/* Barra de búsqueda */}
      <TextInput
        style={styles.searchInput}
        placeholder="Buscar por nombre o email..."
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        placeholderTextColor="#999"
      />

      {/* Panel de filtros */}
      <View style={styles.filtersContainer}>
        <Text style={styles.filterTitle}>Filtros:</Text>

        {/* Selector de usuario */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          <TouchableOpacity
            style={[styles.filterChip, !userFilter && styles.filterChipActive]}
            onPress={() => setUserFilter(null)}
          >
            <Text
              style={!userFilter ? styles.filterTextActive : styles.filterText}
            >
              Todos los usuarios
            </Text>
          </TouchableOpacity>

          {usuarios.map((user) => (
            <TouchableOpacity
              key={user.id}
              style={[
                styles.filterChip,
                userFilter === user.id && styles.filterChipActive,
              ]}
              onPress={() => setUserFilter(user.id)}
            >
              <Text
                style={
                  userFilter === user.id
                    ? styles.filterTextActive
                    : styles.filterText
                }
              >
                {user.nombreCompleto || user.email}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Selector de fecha */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          <TouchableOpacity
            style={[styles.filterChip, !dateFilter && styles.filterChipActive]}
            onPress={() => setDateFilter(null)}
          >
            <Text
              style={!dateFilter ? styles.filterTextActive : styles.filterText}
            >
              Todas las fechas
            </Text>
          </TouchableOpacity>

          {fechas.map((fecha) => (
            <TouchableOpacity
              key={fecha}
              style={[
                styles.filterChip,
                dateFilter === fecha && styles.filterChipActive,
              ]}
              onPress={() => setDateFilter(fecha)}
            >
              <Text
                style={
                  dateFilter === fecha
                    ? styles.filterTextActive
                    : styles.filterText
                }
              >
                {formatDate(fecha)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Selector de planta */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          <TouchableOpacity
            style={[styles.filterChip, !plantFilter && styles.filterChipActive]}
            onPress={() => setPlantFilter(null)}
          >
            <Text
              style={!plantFilter ? styles.filterTextActive : styles.filterText}
            >
              Todas las plantas
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              plantFilter === "Planta 1" && styles.filterChipActive,
            ]}
            onPress={() => setPlantFilter("Planta 1")}
          >
            <Text
              style={
                plantFilter === "Planta 1"
                  ? styles.filterTextActive
                  : styles.filterText
              }
            >
              Planta 1
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              plantFilter === "Planta 2" && styles.filterChipActive,
            ]}
            onPress={() => setPlantFilter("Planta 2")}
          >
            <Text
              style={
                plantFilter === "Planta 2"
                  ? styles.filterTextActive
                  : styles.filterText
              }
            >
              Planta 2
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Botón de limpiar filtros */}
        <TouchableOpacity
          style={styles.clearFiltersButton}
          onPress={limpiarFiltros}
        >
          <MaterialIcons name="clear-all" size={18} color="white" />
          <Text style={styles.clearFiltersText}>Limpiar filtros</Text>
        </TouchableOpacity>
      </View>

      {/* Contador de resultados */}
      <Text style={styles.resultsCount}>
        Mostrando {registrosFiltrados.length} de {registros.length} registros
      </Text>

      {/* Añadir después del contador de resultados */}
      <View style={styles.statusBar}>
        <Text style={styles.statusBarText}>
          {userFilter
            ? `Mostrando registros de un usuario específico`
            : dateFilter
            ? `Mostrando registros de ${formatDate(dateFilter)}`
            : plantFilter
            ? `Mostrando registros de ${plantFilter}`
            : "Mostrando todos los registros"}
        </Text>
        {(userFilter || dateFilter || plantFilter) && (
          <TouchableOpacity onPress={limpiarFiltros}>
            <Text style={styles.clearFiltersButtonText}>Limpiar filtros</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Mostrar indicador de carga o registros */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Cargando registros...</Text>
        </View>
      ) : registrosFiltrados.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="search-off" size={50} color="#ccc" />
          <Text style={styles.emptyText}>No se encontraron registros</Text>
          <Text style={styles.emptySubText}>Intenta con otros filtros</Text>
        </View>
      ) : (
        <FlatList
          data={registrosFiltrados}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const esEntrada = item.tipoRegistro === "entrada";

            return (
              <TouchableOpacity
                style={[
                  styles.card,
                  item.id === highlightedJornadaId && styles.highlightedCard,
                  esEntrada && styles.entryCard,
                ]}
                onPress={() => setSelectedRegistro(item)}
              >
                {esEntrada && (
                  <View style={styles.liveEntryBanner}>
                    <MaterialIcons name="fiber-new" size={18} color="white" />
                    <Text style={styles.liveEntryText}>
                      Entrada en tiempo real
                    </Text>
                  </View>
                )}

                <View style={styles.cardHeader}>
                  <Text style={styles.userTitle}>
                    {item.nombreUsuario || "Usuario sin nombre"}
                  </Text>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => eliminarRegistro(item.id)}
                  >
                    <MaterialIcons name="delete" size={20} color="white" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.date}>📅 {formatDate(item.fecha)}</Text>
                <Text style={styles.email}>
                  📧 {item.email || "Email no disponible"}
                </Text>

                {esEntrada ? (
                  <View style={styles.plantaContainer}>
                    <Text style={styles.plant}>
                      🏭 {item.planta} - {formatearHora(item.timestamp)}
                    </Text>
                  </View>
                ) : (
                  item.plantas &&
                  item.plantas.map((planta, index) => (
                    <View key={index} style={styles.plantaContainer}>
                      <Text style={styles.plant}>
                        🏭 {planta.nombre}: {planta.totalHoras}
                      </Text>
                    </View>
                  ))
                )}

                {!esEntrada && (
                  <Text style={styles.totalHours}>
                    ⏱️ Total: {item.totalHoras}
                  </Text>
                )}

                <View style={styles.imagesContainer}>
                  <RenderImage label="Entrada" imageUri={item.entryImage} />
                  {!esEntrada && (
                    <RenderImage label="Salida" imageUri={item.exitImage} />
                  )}
                </View>

                <View style={styles.locationButtons}>
                  {item.entryLocation && (
                    <TouchableOpacity
                      style={styles.mapButton}
                      onPress={() =>
                        abrirGoogleMaps(
                          item.entryLocation.latitude,
                          item.entryLocation.longitude
                        )
                      }
                    >
                      <MaterialIcons
                        name="location-on"
                        size={18}
                        color="white"
                      />
                      <Text style={styles.mapButtonText}>
                        Ver ubicación entrada
                      </Text>
                    </TouchableOpacity>
                  )}

                  {!esEntrada && item.exitLocation && (
                    <TouchableOpacity
                      style={styles.mapButton}
                      onPress={() =>
                        abrirGoogleMaps(
                          item.exitLocation.latitude,
                          item.exitLocation.longitude
                        )
                      }
                    >
                      <MaterialIcons
                        name="location-on"
                        size={18}
                        color="white"
                      />
                      <Text style={styles.mapButtonText}>
                        Ver ubicación salida
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}

      {/* Modal para detalles del registro */}
      {selectedRegistro && (
        <Modal
          animationType="slide"
          transparent={true}
          visible={true}
          onRequestClose={() => setSelectedRegistro(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Detalles del Registro</Text>
                <TouchableOpacity onPress={() => setSelectedRegistro(null)}>
                  <MaterialIcons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalContent}>
                <Text style={styles.modalUser}>
                  {selectedRegistro.nombreUsuario}
                </Text>
                <Text style={styles.modalText}>
                  📅 Fecha: {formatDate(selectedRegistro.fecha)}
                </Text>
                <Text style={styles.modalText}>
                  📧 Email: {selectedRegistro.email}
                </Text>

                <View style={styles.separator} />

                {/* Resumen de plantas */}
                <Text style={styles.sectionTitle}>Plantas trabajadas:</Text>
                {selectedRegistro.plantas?.map((planta, index) => (
                  <View key={index} style={styles.modalPlantaContainer}>
                    <Text style={styles.modalPlantName}>{planta.nombre}</Text>
                    <Text style={styles.modalPlantHours}>
                      {planta.totalHoras}
                    </Text>

                    {/* Detalles de sesiones en esta planta */}
                    {planta.sesiones?.map((sesion, sIndex) => (
                      <View key={sIndex} style={styles.modalSesion}>
                        <Text style={styles.modalSesionText}>
                          Entrada: {formatDate(sesion.entry)}{" "}
                          {sesion.entry
                            ? new Date(sesion.entry).toLocaleTimeString()
                            : ""}
                        </Text>
                        <Text style={styles.modalSesionText}>
                          Salida:{" "}
                          {sesion.exit
                            ? `${formatDate(sesion.exit)} ${new Date(
                                sesion.exit
                              ).toLocaleTimeString()}`
                            : "Pendiente"}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}

                <View style={styles.separator} />

                {/* Imágenes ampliadas */}
                <Text style={styles.sectionTitle}>Imágenes:</Text>
                <View style={styles.modalImagesContainer}>
                  {selectedRegistro.entryImage && (
                    <View style={styles.modalImageWrapper}>
                      <Text style={styles.modalImageLabel}>Entrada</Text>
                      <Image
                        source={{ uri: selectedRegistro.entryImage }}
                        style={styles.modalImage}
                        resizeMode="contain"
                      />
                    </View>
                  )}

                  {selectedRegistro.exitImage && (
                    <View style={styles.modalImageWrapper}>
                      <Text style={styles.modalImageLabel}>Salida</Text>
                      <Image
                        source={{ uri: selectedRegistro.exitImage }}
                        style={styles.modalImage}
                        resizeMode="contain"
                      />
                    </View>
                  )}
                </View>

                <View style={styles.separator} />

                {/* Ubicaciones */}
                <Text style={styles.sectionTitle}>Ubicaciones:</Text>
                <View style={styles.modalLocationButtons}>
                  {selectedRegistro.entryLocation ? (
                    <TouchableOpacity
                      style={styles.modalMapButton}
                      onPress={() =>
                        abrirGoogleMaps(
                          selectedRegistro.entryLocation.latitude,
                          selectedRegistro.entryLocation.longitude
                        )
                      }
                    >
                      <MaterialIcons
                        name="location-on"
                        size={20}
                        color="white"
                      />
                      <Text style={styles.modalMapButtonText}>
                        Ver ubicación de entrada
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.modalNoLocation}>
                      Ubicación de entrada no disponible
                    </Text>
                  )}

                  {selectedRegistro.exitLocation ? (
                    <TouchableOpacity
                      style={styles.modalMapButton}
                      onPress={() =>
                        abrirGoogleMaps(
                          selectedRegistro.exitLocation.latitude,
                          selectedRegistro.exitLocation.longitude
                        )
                      }
                    >
                      <MaterialIcons
                        name="location-on"
                        size={20}
                        color="white"
                      />
                      <Text style={styles.modalMapButtonText}>
                        Ver ubicación de salida
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.modalNoLocation}>
                      Ubicación de salida no disponible
                    </Text>
                  )}
                </View>

                {/* Botón de eliminar */}
                <TouchableOpacity
                  style={styles.modalDeleteButton}
                  onPress={() => {
                    setSelectedRegistro(null);
                    setTimeout(
                      () => eliminarRegistro(selectedRegistro.id),
                      500
                    );
                  }}
                >
                  <MaterialIcons name="delete" size={20} color="white" />
                  <Text style={styles.modalDeleteButtonText}>
                    Eliminar registro
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#212529",
    marginBottom: 16,
    textAlign: "center",
  },
  searchInput: {
    backgroundColor: "white",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#dee2e6",
    fontSize: 16,
    color: "#495057",
  },
  filtersContainer: {
    marginBottom: 16,
  },
  filterTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#495057",
    marginBottom: 8,
  },
  filterScroll: {
    flexDirection: "row",
    marginBottom: 10,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
    backgroundColor: "#e9ecef",
    borderWidth: 1,
    borderColor: "#ced4da",
  },
  filterChipActive: {
    backgroundColor: "#007AFF",
    borderColor: "#0063cc",
  },
  filterText: {
    fontSize: 14,
    color: "#495057",
  },
  filterTextActive: {
    fontSize: 14,
    color: "white",
    fontWeight: "500",
  },
  clearFiltersButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6c757d",
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  clearFiltersText: {
    color: "white",
    marginLeft: 8,
    fontWeight: "500",
  },
  resultsCount: {
    fontSize: 14,
    color: "#6c757d",
    marginBottom: 10,
    fontStyle: "italic",
  },
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ecf0f1",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 6,
  },
  statusBarText: {
    fontSize: 14,
    color: "#34495e",
    flex: 1,
  },
  clearFiltersButtonText: {
    color: "#e74c3c",
    fontWeight: "500",
    fontSize: 14,
    marginLeft: 8,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  highlightedCard: {
    borderWidth: 2,
    borderColor: "#007AFF",
  },
  entryCard: {
    backgroundColor: "#e3f2fd",
    borderLeftWidth: 4,
    borderLeftColor: "#2196f3",
  },
  liveEntryBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2196f3",
    padding: 6,
    borderRadius: 4,
    marginBottom: 8,
  },
  liveEntryText: {
    color: "white",
    marginLeft: 4,
    fontSize: 12,
    fontWeight: "500",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  userTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#343a40",
    flex: 1,
  },
  deleteButton: {
    backgroundColor: "#dc3545",
    borderRadius: 4,
    padding: 6,
  },
  date: {
    fontSize: 15,
    color: "#495057",
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: "#6c757d",
    marginBottom: 10,
  },
  plantaContainer: {
    backgroundColor: "#f1f8e9",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  plant: {
    fontSize: 15,
    fontWeight: "500",
    color: "#33691e",
  },
  totalHours: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0275d8",
    marginVertical: 10,
  },
  imagesContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 12,
  },
  imageWrapper: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  imageLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#495057",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: 4,
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 1,
    borderBottomRightRadius: 8,
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
    color: "#adb5bd",
    marginTop: 8,
    fontSize: 14,
  },
  locationButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 10,
  },
  mapButton: {
    backgroundColor: "#5cb85c",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  mapButtonText: {
    color: "white",
    marginLeft: 6,
    fontSize: 14,
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#6c757d",
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 18,
    color: "#6c757d",
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 14,
    color: "#adb5bd",
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "90%",
    maxHeight: "90%",
    backgroundColor: "white",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#212529",
  },
  modalContent: {
    padding: 16,
  },
  modalUser: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#343a40",
    marginBottom: 8,
  },
  modalText: {
    fontSize: 16,
    color: "#495057",
    marginBottom: 6,
  },
  separator: {
    height: 1,
    backgroundColor: "#dee2e6",
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#343a40",
    marginBottom: 12,
  },
  modalPlantaContainer: {
    backgroundColor: "#f1f8e9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  modalPlantName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#33691e",
    marginBottom: 6,
  },
  modalPlantHours: {
    fontSize: 16,
    color: "#3d5afe",
    fontWeight: "500",
    marginBottom: 10,
  },
  modalSesion: {
    backgroundColor: "white",
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  modalSesionText: {
    fontSize: 14,
    color: "#495057",
  },
  modalImagesContainer: {
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  modalImageWrapper: {
    width: "100%",
    aspectRatio: 4 / 3,
    marginBottom: 16,
  },
  modalImageLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#343a40",
    marginBottom: 8,
  },
  modalImage: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
  },
  modalLocationButtons: {
    marginVertical: 8,
  },
  modalMapButton: {
    backgroundColor: "#28a745",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
  },
  modalMapButtonText: {
    color: "white",
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "500",
  },
  modalNoLocation: {
    fontSize: 14,
    color: "#6c757d",
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 10,
  },
  modalDeleteButton: {
    backgroundColor: "#dc3545",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 16,
  },
  modalDeleteButtonText: {
    color: "white",
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "500",
  },
  entryCard: {
    borderLeftWidth: 4,
    borderLeftColor: "#2ecc71", // Verde para indicar entrada
    backgroundColor: "#f1fff6", // Fondo ligeramente verde
  },

  liveEntryBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2ecc71",
    padding: 6,
    borderRadius: 4,
    marginBottom: 10,
    alignSelf: "flex-start",
  },

  liveEntryText: {
    color: "white",
    fontWeight: "600",
    fontSize: 12,
    marginLeft: 4,
  },
});

export default RegistrosUsuarios;
