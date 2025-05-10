import { Asset } from "expo-asset"; // Importa expo-asset
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const Home = ({ navigation }) => {
  // Carga la imagen con expo-asset
  const logoHome = Asset.fromModule(require("../assets/logoHome.jpg")).uri;

  return (
    <View style={styles.container}>
      {/* Usa la imagen cargada con expo-asset */}
      <Image source={{ uri: logoHome }} style={styles.logo} />
      <Text style={styles.title}>
        Bienvenid@ a Concentrados y Servicios Torres S.A.S
      </Text>
      <Text style={styles.subtitle}>Selecciona una opción para continuar:</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate("Login")}
        >
          <Text style={styles.buttonText}>Iniciar Sesión</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]} // Usando un estilo adicional para diferenciarlos
          onPress={() => navigation.navigate("CrearUsuarios")}
        >
          <Text style={styles.buttonText}>Crear Usuario</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#dcdcdc",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  logo: {
    width: 200,
    height: 200,
    marginBottom: 20,
    borderRadius: 100,
    borderWidth: 2, // Opcional: Borde para destacar el logo
    borderColor: "#fff",
  },
  title: {
    fontFamily: "Roboto",
    fontSize: 24,
    fontWeight: "bold",
    color: "black", // Cambiado a negro para mejor visibilidad sin gradiente
    textAlign: "center",
    marginBottom: 20,
  },
  subtitle: {
    fontFamily: "sans-serif",
    fontSize: 18,
    color: "black", // Cambiado a negro para mejor visibilidad sin gradiente
    textAlign: "center",
    marginBottom: 40,
  },
  buttonContainer: {
    width: "80%",
  },
  button: {
    backgroundColor: "#2164a8", // Azul principal
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#fff", // Opcional: Borde para resaltar el botón
  },
  buttonSecondary: {
    backgroundColor: "#4CAF50", // Verde secundario
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default Home;
