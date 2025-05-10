// components/IconWrapper.js
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import React from "react";

export const Trash2 = ({ size = 24, color = "white", ...props }) => (
  <MaterialIcons name="delete" size={size} color={color} {...props} />
);

export const Edit = ({ size = 24, color = "white", ...props }) => (
  <MaterialIcons name="edit" size={size} color={color} {...props} />
);

export default {
  Trash2,
  Edit,
};
