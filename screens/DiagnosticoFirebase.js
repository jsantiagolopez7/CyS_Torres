import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { auth, storage } from "../database/firebase";

const DiagnosticoFirebase = () => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [allTests, setAllTests] = useState({
    auth: { status: "pending", message: "" },
    firestore: { status: "pending", message: "" },
    storage: { status: "pending", message: "" },
    uploadTest: { status: "pending", message: "" },
    downloadTest: { status: "pending", message: "" },
    asyncStorage: { status: "pending", message: "" },
  });

  // Añadir un resultado al log
  const addResult = (message, isError = false) => {
    setResults((prev) => [
      ...prev,
      { message, isError, timestamp: new Date().toISOString() },
    ]);
  };

  // Actualizar el estado de un test específico
  const updateTestStatus = (test, status, message) => {
    setAllTests((prev) => ({
      ...prev,
      [test]: { status, message },
    }));
  };

  // Test de Firebase Authentication
  const testAuth = async () => {
    try {
      addResult("Verificando autenticación...");

      if (!auth.currentUser) {
        updateTestStatus("auth", "failed", "No hay usuario autenticado");
        addResult("❌ No hay usuario autenticado", true);
        return false;
      }

      addResult(`✅ Usuario autenticado: ${auth.currentUser.uid}`);
      updateTestStatus("auth", "passed", `UID: ${auth.currentUser.uid}`);
      return true;
    } catch (error) {
      updateTestStatus("auth", "failed", error.message);
      addResult(`❌ Error en autenticación: ${error.message}`, true);
      return false;
    }
  };

  // Test de Firebase Firestore
  const testFirestore = async () => {
    if (!(await testAuth())) return false;

    try {
      addResult("Verificando Firestore...");
      const db = getFirestore();
      const userId = auth.currentUser.uid;

      // Crear un documento temporal para pruebas
      const testDocRef = doc(
        db,
        "diagnostic_tests",
        `test_${userId}_${Date.now()}`
      );
      await setDoc(testDocRef, {
        timestamp: new Date().toISOString(),
        test: "firestore_connection_test",
      });

      addResult("✅ Firestore funcionando correctamente");
      updateTestStatus("firestore", "passed", "Conexión exitosa");
      return true;
    } catch (error) {
      updateTestStatus("firestore", "failed", error.message);
      addResult(`❌ Error en Firestore: ${error.message}`, true);
      return false;
    }
  };

  // Test de Firebase Storage
  const testStorage = async () => {
    if (!(await testAuth())) return false;

    try {
      addResult("Verificando Storage...");

      // Verificar que storage esté disponible
      if (!storage) {
        updateTestStatus("storage", "failed", "Objeto storage no disponible");
        addResult("❌ Objeto storage no inicializado", true);
        return false;
      }

      // Verificar configuración
      const bucketUrl = storage.app.options.storageBucket;
      addResult(`ℹ️ Bucket configurado: ${bucketUrl}`);

      // Verificar si podemos crear una referencia
      try {
        const testRef = ref(storage, "test_file.txt");
        addResult("✅ Creación de referencias en Storage funciona");
        updateTestStatus("storage", "passed", `Bucket: ${bucketUrl}`);
        return true;
      } catch (refError) {
        updateTestStatus(
          "storage",
          "failed",
          `Error creando referencia: ${refError.message}`
        );
        addResult(`❌ Error creando referencia: ${refError.message}`, true);
        return false;
      }
    } catch (error) {
      updateTestStatus("storage", "failed", error.message);
      addResult(`❌ Error en Storage: ${error.message}`, true);
      return false;
    }
  };

  // Test de subida a Storage
  const testUpload = async () => {
    if (!(await testStorage())) return false;

    try {
      addResult("Probando subida a Storage...");

      // Crear un archivo de texto simple para prueba
      const testContent = "Este es un archivo de prueba para Firebase Storage.";
      const testBlob = new Blob([testContent], { type: "text/plain" });

      const userId = auth.currentUser.uid;
      const testPath = `diagnostic_tests/${userId}_${Date.now()}.txt`;
      const testRef = ref(storage, testPath);

      // Subir el archivo
      addResult(`Subiendo archivo a ${testPath}...`);
      await uploadBytes(testRef, testBlob);

      addResult("✅ Archivo subido correctamente");
      updateTestStatus("uploadTest", "passed", "Subida exitosa");

      // Guardar la ruta para la prueba de descarga
      AsyncStorage.setItem("last_test_path", testPath);

      return { testPath, testRef };
    } catch (error) {
      updateTestStatus("uploadTest", "failed", error.message);
      addResult(`❌ Error en subida: ${error.message}`, true);
      addResult(`Detalles: ${JSON.stringify(error)}`, true);
      return false;
    }
  };

  // Test de descarga de Storage
  const testDownload = async () => {
    try {
      addResult("Probando descarga desde Storage...");

      // Intentar usar la ruta del test anterior
      let testPath = await AsyncStorage.getItem("last_test_path");
      let testRef;

      if (!testPath) {
        // Si no hay una ruta guardada, hacer una nueva subida
        const uploadResult = await testUpload();
        if (!uploadResult) return false;

        testPath = uploadResult.testPath;
        testRef = uploadResult.testRef;
      } else {
        testRef = ref(storage, testPath);
      }

      // Intentar obtener la URL de descarga
      addResult(`Obteniendo URL de ${testPath}...`);

      try {
        const downloadURL = await getDownloadURL(testRef);
        addResult(`✅ URL obtenida: ${downloadURL}`);
        updateTestStatus(
          "downloadTest",
          "passed",
          "URL generada correctamente"
        );

        // Limpiar - borrar el archivo de prueba
        try {
          await deleteObject(testRef);
          addResult("🧹 Archivo de prueba eliminado");
        } catch (deleteError) {
          addResult(
            `⚠️ No se pudo eliminar el archivo de prueba: ${deleteError.message}`
          );
        }

        return true;
      } catch (downloadError) {
        updateTestStatus("downloadTest", "failed", downloadError.message);
        addResult(`❌ Error obteniendo URL: ${downloadError.message}`, true);
        addResult(`Detalles: ${JSON.stringify(downloadError)}`, true);
        return false;
      }
    } catch (error) {
      updateTestStatus("downloadTest", "failed", error.message);
      addResult(`❌ Error general en descarga: ${error.message}`, true);
      return false;
    }
  };

  // Test de AsyncStorage
  const testAsyncStorage = async () => {
    try {
      addResult("Verificando AsyncStorage...");

      // Escribir un valor de prueba
      const testKey = "diagnostic_test_key";
      const testValue = `test_value_${Date.now()}`;

      await AsyncStorage.setItem(testKey, testValue);

      // Leer el valor de vuelta
      const readValue = await AsyncStorage.getItem(testKey);

      if (readValue === testValue) {
        addResult("✅ AsyncStorage funcionando correctamente");
        updateTestStatus("asyncStorage", "passed", "Lectura/escritura exitosa");

        // Limpiar
        await AsyncStorage.removeItem(testKey);
        return true;
      } else {
        updateTestStatus("asyncStorage", "failed", "Los valores no coinciden");
        addResult("❌ Error: valores de lectura/escritura no coinciden", true);
        return false;
      }
    } catch (error) {
      updateTestStatus("asyncStorage", "failed", error.message);
      addResult(`❌ Error en AsyncStorage: ${error.message}`, true);
      return false;
    }
  };

  // Ejecutar todos los tests
  const runAllTests = async () => {
    setLoading(true);
    setResults([]);

    // Reiniciar todos los estados de prueba
    setAllTests({
      auth: { status: "running", message: "Ejecutando..." },
      firestore: { status: "pending", message: "" },
      storage: { status: "pending", message: "" },
      uploadTest: { status: "pending", message: "" },
      downloadTest: { status: "pending", message: "" },
      asyncStorage: { status: "pending", message: "" },
    });

    addResult("🔍 Iniciando diagnóstico completo...");

    // Tests secuenciales
    await testAuth();

    setAllTests((prev) => ({
      ...prev,
      firestore: { status: "running", message: "Ejecutando..." },
    }));
    await testFirestore();

    setAllTests((prev) => ({
      ...prev,
      storage: { status: "running", message: "Ejecutando..." },
    }));
    await testStorage();

    setAllTests((prev) => ({
      ...prev,
      uploadTest: { status: "running", message: "Ejecutando..." },
    }));
    await testUpload();

    setAllTests((prev) => ({
      ...prev,
      downloadTest: { status: "running", message: "Ejecutando..." },
    }));
    await testDownload();

    setAllTests((prev) => ({
      ...prev,
      asyncStorage: { status: "running", message: "Ejecutando..." },
    }));
    await testAsyncStorage();

    addResult("✅ Diagnóstico completo finalizado");
    setLoading(false);
  };

  // Estado inicial
  useEffect(() => {
    setResults([
      {
        message:
          "Presiona 'Iniciar Diagnóstico' para verificar tu conexión a Firebase",
        isError: false,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  // Renderizar indicador de estado
  const renderTestStatus = (status, message) => {
    let icon, color;

    switch (status) {
      case "passed":
        icon = "✅";
        color = "#34D399";
        break;
      case "failed":
        icon = "❌";
        color = "#F87171";
        break;
      case "running":
        icon = "🔄";
        color = "#60A5FA";
        break;
      default:
        icon = "⏳";
        color = "#9CA3AF";
    }

    return (
      <View
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}
      >
        <Text style={{ fontSize: 16, marginRight: 8 }}>{icon}</Text>
        <View>
          <Text style={{ fontSize: 14, color, fontWeight: "bold" }}>
            {status === "running"
              ? "Ejecutando..."
              : status === "passed"
              ? "Exitoso"
              : status === "failed"
              ? "Fallido"
              : "Pendiente"}
          </Text>
          {message ? (
            <Text style={{ fontSize: 12, color: "#6B7280" }}>{message}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Diagnóstico de Firebase</Text>

      <View style={styles.testsContainer}>
        <Text style={styles.sectionTitle}>Estado de las Pruebas</Text>
        <View style={styles.testItem}>
          <Text style={styles.testLabel}>Autenticación:</Text>
          {renderTestStatus(allTests.auth.status, allTests.auth.message)}
        </View>

        <View style={styles.testItem}>
          <Text style={styles.testLabel}>Firestore:</Text>
          {renderTestStatus(
            allTests.firestore.status,
            allTests.firestore.message
          )}
        </View>

        <View style={styles.testItem}>
          <Text style={styles.testLabel}>Storage:</Text>
          {renderTestStatus(allTests.storage.status, allTests.storage.message)}
        </View>

        <View style={styles.testItem}>
          <Text style={styles.testLabel}>Subida a Storage:</Text>
          {renderTestStatus(
            allTests.uploadTest.status,
            allTests.uploadTest.message
          )}
        </View>

        <View style={styles.testItem}>
          <Text style={styles.testLabel}>Descarga de Storage:</Text>
          {renderTestStatus(
            allTests.downloadTest.status,
            allTests.downloadTest.message
          )}
        </View>

        <View style={styles.testItem}>
          <Text style={styles.testLabel}>AsyncStorage:</Text>
          {renderTestStatus(
            allTests.asyncStorage.status,
            allTests.asyncStorage.message
          )}
        </View>
      </View>

      <Button
        title={loading ? "Ejecutando diagnóstico..." : "Iniciar Diagnóstico"}
        onPress={runAllTests}
        disabled={loading}
        color="#4F46E5"
      />

      <Text style={styles.sectionTitle}>Registro de Actividad</Text>
      <ScrollView style={styles.logsContainer}>
        {results.map((result, index) => (
          <Text
            key={index}
            style={[styles.logItem, result.isError ? styles.errorLog : null]}
          >
            {result.message}
          </Text>
        ))}
        {loading && <ActivityIndicator size="small" color="#4F46E5" />}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#F9FAFB",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#111827",
    textAlign: "center",
  },
  testsContainer: {
    backgroundColor: "white",
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  testItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  testLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    width: 120,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    marginTop: 10,
    color: "#4B5563",
  },
  logsContainer: {
    flex: 1,
    backgroundColor: "#1F2937",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  logItem: {
    fontSize: 12,
    color: "#D1D5DB",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 4,
  },
  errorLog: {
    color: "#F87171",
  },
});

export default DiagnosticoFirebase;
