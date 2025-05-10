import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    padding: 15,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginVertical: 20,
  },
  usuarioContainer: {
    backgroundColor: "#2d2d2d",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  usuarioNombre: {
    color: "#4CAF50",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },
  jornadaContainer: {
    backgroundColor: "#333",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  fecha: {
    color: "#FFC107",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 5,
  },
  plantaContainer: {
    marginVertical: 8,
    padding: 10,
    backgroundColor: "#404040",
    borderRadius: 6,
  },
  subtitle: {
    color: "#2196F3",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 5,
  },
  registroItem: {
    marginVertical: 5,
    padding: 8,
    backgroundColor: "#555",
    borderRadius: 4,
  },
  accion: {
    color: "#fff",
    fontSize: 12,
  },
  ubicacion: {
    color: "#888",
    fontSize: 10,
    marginTop: 3,
  },
  totalHoras: {
    color: "#FFC107",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
    textAlign: "right",
  },
  buttonExport: {
    backgroundColor: "#9C27B0",
    padding: 15,
    borderRadius: 8,
    margin: 20,
    alignItems: "center",
    elevation: 3,
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
});

export default styles;
