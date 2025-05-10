import { getAuth, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { db } from "../database/firebase"; // Ruta correcta a Firestore

const AdminScreen = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState([]);
  const [userInput, setUserInput] = useState(""); // Estado para el UID o correo
  const auth = getAuth();
  const functions = getFunctions();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const idTokenResult = await user.getIdTokenResult(true);
        console.log("🔍 Custom Claims:", idTokenResult.claims);

        if (idTokenResult.claims.role === "admin") {
          setIsAdmin(true);
          fetchUsers(); // Si es admin, cargar usuarios
        } else {
          setIsAdmin(false);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Obtener lista de usuarios desde Firestore
  const fetchUsers = async () => {
    try {
      const q = query(collection(db, "users"));
      const querySnapshot = await getDocs(q);

      const usersList = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        // Asegurar que tenga campo 'role'
        role: doc.data().role || "user",
      }));

      setUsers(usersList);
    } catch (error) {
      console.error("Error obteniendo usuarios:", error);
      Alert.alert("Error", "No tienes permisos para ver usuarios");
    }
  };

  // Asignar rol de administrador (desde la lista)
  const handleRoleChange = async (user) => {
    if (user.role === "admin") {
      Alert.alert("Acción no permitida", "Este usuario ya es administrador.");
      return;
    }

    Alert.alert(
      "Confirmar",
      `¿Estás seguro de que quieres hacer a ${user.email} un administrador?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Aceptar",
          onPress: async () => {
            await handleMakeAdmin(user.email);
          },
        },
      ]
    );
  };

  // Función para asignar admin usando UID o correo ingresado
  const handleMakeAdminManual = async () => {
    if (!userInput.trim()) {
      Alert.alert("Error", "Debes ingresar un UID o correo.");
      return;
    }
    await handleMakeAdmin(userInput.trim());
    setUserInput(""); // Limpiar el campo de texto después
  };

  // Función que asigna el rol de administrador en Firebase
  const handleMakeAdmin = async (emailOrUID) => {
    try {
      const addAdminRole = httpsCallable(functions, "addAdminRole");
      await addAdminRole({ email: emailOrUID });

      // Refrescar token del usuario actual
      const user = auth.currentUser;
      if (user) {
        await user.getIdToken(true); // Refrescar token
        console.log("Token actualizado");
      }

      Alert.alert(
        "Éxito",
        `El usuario (${emailOrUID}) ahora es administrador.`
      );
      fetchUsers(); // Refrescar la lista de usuarios
    } catch (error) {
      console.error("Error al asignar rol:", error);
      Alert.alert("Error", "No se pudo cambiar el rol.");
    }
  };

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text>No tienes permisos para ver esta pantalla.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 10 }}>
        Administrar Roles
      </Text>

      {/* Caja de texto para ingresar UID o correo */}
      <TextInput
        value={userInput}
        onChangeText={setUserInput}
        placeholder="Ingrese UID o Correo"
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          padding: 10,
          marginBottom: 10,
          borderRadius: 5,
        }}
      />
      <Button title="Hacer Administrador" onPress={handleMakeAdminManual} />

      {/* Lista de usuarios */}
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={{
              padding: 10,
              marginBottom: 5,
              borderBottomWidth: 1,
              borderBottomColor: "#ccc",
            }}
          >
            <Text style={{ fontSize: 16 }}>{item.email}</Text>
            <Text>Rol: {item.role}</Text>
            {item.role !== "admin" && (
              <TouchableOpacity
                onPress={() => handleRoleChange(item)}
                style={{
                  backgroundColor: "blue",
                  padding: 5,
                  marginTop: 5,
                  borderRadius: 5,
                }}
              >
                <Text style={{ color: "white", textAlign: "center" }}>
                  Hacer Administrador
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </View>
  );
};

export default AdminScreen;
