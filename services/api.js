import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { Platform } from "react-native";

// Configuración dinámica de la URL de API según el entorno
const getApiUrl = () => {
  // Si estamos en un emulador Android, usa 10.0.2.2 (que apunta al localhost de la máquina host)
  if (__DEV__ && Platform.OS === "android") {
    return "http://192.168.5.80:5250/swagger/index.html";
  }
  // Si estamos en un simulador iOS, usa localhost
  else if (__DEV__ && Platform.OS === "ios") {
    return "http://localhost:5250/swagger/index.html";
  }
  // Para dispositivos físicos, usa la IP de tu computadora en la red local
  else {
    // Reemplaza con tu dirección IP real (obtenida con ipconfig)
    return "http://192.168.5.80:5250/swagger/index.html";
  }
};

// Crear instancia de axios
const api = axios.create({
  baseURL: getApiUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor para añadir token JWT a las peticiones
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem("token"); // Cambiado de "authToken" a "token"
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error("Error al obtener el token:", error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para manejar errores de respuesta
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Mejorar los mensajes de error
    if (error.response) {
      // El servidor respondió con un código de estado fuera del rango 2xx
      console.error(
        `Error de API: ${error.response.status} - ${JSON.stringify(
          error.response.data
        )}`
      );
    } else if (error.request) {
      // La petición fue hecha pero no se recibió respuesta
      console.error(
        `Error de red: No se pudo conectar a ${getApiUrl()}`,
        error.request
      );
    } else {
      // Algo ocurrió al configurar la petición
      console.error("Error:", error.message);
    }
    return Promise.reject(error);
  }
);

// Servicios de autenticación
export const authService = {
  // Iniciar sesión
  login: async (email, password) => {
    try {
      const response = await api.post("/auth/login", { email, password });

      // Guardar token y datos del usuario
      await AsyncStorage.setItem("token", response.data.token);
      await AsyncStorage.setItem("userData", JSON.stringify(response.data));

      console.log("Inicio de sesión exitoso:", response.data);
      return response.data;
    } catch (error) {
      console.error("Error en login:", error);
      throw error;
    }
  },

  // Registrar nuevo usuario
  register: async (userData) => {
    try {
      const response = await api.post("/auth/register", userData);
      console.log("Registro exitoso:", response.data);
      return response.data;
    } catch (error) {
      console.error("Error en registro:", error);
      throw error;
    }
  },

  // Cerrar sesión
  logout: async () => {
    await AsyncStorage.removeItem("token");
    await AsyncStorage.removeItem("userData");
    console.log("Sesión cerrada");
  },

  // Verificar token (opcional, si implementas esta funcionalidad en tu API)
  verifyToken: async () => {
    try {
      const response = await api.get("/auth/verify-token");
      return response.data;
    } catch (error) {
      console.error("Error verificando token:", error);
      throw error;
    }
  },
};

// Servicios para jornadas
export const jornadaService = {
  // Obtener todas las jornadas
  getJornadas: async () => {
    try {
      const response = await api.get("/jornadas");
      return response.data;
    } catch (error) {
      console.error("Error obteniendo jornadas:", error);
      throw error;
    }
  },

  // Obtener una jornada específica
  getJornadaById: async (id) => {
    try {
      const response = await api.get(`/jornadas/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error obteniendo jornada ${id}:`, error);
      throw error;
    }
  },

  // Crear una nueva jornada
  createJornada: async (jornadaData) => {
    try {
      const response = await api.post("/jornadas", jornadaData);
      return response.data;
    } catch (error) {
      console.error("Error creando jornada:", error);
      throw error;
    }
  },

  // Eliminar jornada (solo admin)
  deleteJornada: async (id) => {
    try {
      await api.delete(`/jornadas/${id}`);
      return true;
    } catch (error) {
      console.error("Error eliminando jornada:", error);
      throw error;
    }
  },
};

// Exportar API para posibles usos directos
export { api };

// Exportar servicios
export default {
  auth: authService,
  jornadas: jornadaService,
};
