import { doc, getDoc, getFirestore } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Alert, Button, StyleSheet, Text, View } from "react-native";
import { auth } from "../database/firebase"; // Asegúrate de que la ruta sea correcta

const ListaUsuarios = ({ navigation }) => {
  // Añadir navigation como prop
  const [connectionStatus, setConnectionStatus] = useState("Desconocido");
  const [loading, setLoading] = useState(false);

  const checkConnection = async () => {
    setLoading(true);
    setConnectionStatus("Verificando...");

    try {
      const user = auth.currentUser;
      if (!user) {
        Alert.alert("Error", "No hay usuario autenticado.");
        setConnectionStatus("Desconocido");
        setLoading(false);
        return;
      }

      const db = getFirestore();
      const testRef = doc(db, "_connection_test", "status");

      const docSnap = await getDoc(testRef);
      if (docSnap.exists()) {
        setConnectionStatus("Conectado a Firebase");
      } else {
        setConnectionStatus("No se pudo acceder a Firebase");
      }
    } catch (error) {
      console.error("Error al verificar conexión a Firebase:", error);
      setConnectionStatus("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkConnection(); // Verificar conexión al montar el componente
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>
        Estado de Conexión: {connectionStatus}
      </Text>
      <Button
        title="Verificar Conexión"
        onPress={checkConnection}
        disabled={loading}
      />
      <View style={styles.buttonSpacing} />
      <Button
        title="Diagnóstico Completo de Firebase"
        onPress={() => navigation.navigate("DiagnosticoFirebase")}
        color="#6366F1"
      />
      {loading && <Text>Cargando...</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  statusText: {
    fontSize: 18,
    marginBottom: 20,
  },
  buttonSpacing: {
    height: 10,
  },
});

export default ListaUsuarios;
