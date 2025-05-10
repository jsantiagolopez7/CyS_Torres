import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert } from "react-native";

// URL base de tu API
const API_BASE_URL = "http://192.168.5.80:5250/swagger/index.html";
 // Cambia esto según tu entorno

const CrearUsuarios = ({ navigation }) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Función para manejar el registro de usuarios
  const registerUser = async () => {
    if (!firstName || !lastName || !email || !password) {
      Alert.alert("Error", "Por favor, completa todos los campos.");
      return;
    }

    setLoading(true);

    try {
      // Realiza una solicitud POST al endpoint de registro de tu API
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });

      if (!response.ok) {
        throw new Error(
          "Error al registrar usuario. Verifica los datos ingresados."
        );
      }

      const data = await response.json();

      // Muestra un mensaje de éxito
      Alert.alert("Éxito", "Usuario registrado correctamente.");
      console.log("Usuario registrado:", data);

      // Redirige al usuario a la pantalla de inicio de sesión
      navigation.navigate("Login");
    } catch (error) {
      console.error("Error en el registro:", error.message);
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crear Usuario</Text>

      <TextInput
        style={styles.input}
        placeholder="Nombre"
        value={firstName}
        onChangeText={setFirstName}
      />

      <TextInput
        style={styles.input}
        placeholder="Apellido"
        value={lastName}
        onChangeText={setLastName}
      />

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
        title={loading ? "Cargando..." : "Registrar"}
        onPress={registerUser}
        disabled={loading}
      />

      <Text style={styles.loginText}>
        ¿Ya tienes una cuenta?{" "}
        <Text
          style={styles.loginLink}
          onPress={() => navigation.navigate("Login")}
        >
          Inicia sesión aquí
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
  loginText: {
    marginTop: 20,
    textAlign: "center",
  },
  loginLink: {
    color: "blue",
    fontWeight: "bold",
  },
});

export default CrearUsuarios;
