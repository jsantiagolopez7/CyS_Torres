import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// URL base de tu API
const API_BASE_URL = "http://192.168.5.80:5250/swagger/index.html";
 // Cambia esto según tu entorno

const Login = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Función para manejar el inicio de sesión
  const loginUser = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Por favor, completa todos los campos.");
      return;
    }

    setLoading(true);

    try {
      // Realiza una solicitud POST al endpoint de inicio de sesión de tu API
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error(
          "Credenciales inválidas. Verifica tu correo y contraseña."
        );
      }

      const data = await response.json();

      // Guarda el token JWT en AsyncStorage
      await AsyncStorage.setItem("token", data.token);

      // Opcional: Guarda información adicional del usuario si es necesario
      console.log("Inicio de sesión exitoso:", data);

      // Redirige al usuario a la pantalla principal (por ejemplo, Dashboard)
      navigation.navigate("Dashboard");
    } catch (error) {
      console.error("Error en el inicio de sesión:", error.message);
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Iniciar Sesión</Text>

      <TextInput
        style={styles.input}
        placeholder="Correo Electrónico"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Button
        title={loading ? "Cargando..." : "Iniciar Sesión"}
        onPress={loginUser}
        disabled={loading}
      />

      <Text style={styles.registerText}>
        ¿No tienes una cuenta?{" "}
        <Text
          style={styles.registerLink}
          onPress={() => navigation.navigate("Register")}
        >
          Regístrate aquí
        </Text>
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    height: 50,
    borderColor: "#ccc",
    borderWidth: 1,
    borderRadius: 5,
    marginBottom: 15,
    paddingHorizontal: 10,
  },
  registerText: {
    marginTop: 20,
    textAlign: "center",
  },
  registerLink: {
    color: "blue",
    fontWeight: "bold",
  },
});

export default Login;
