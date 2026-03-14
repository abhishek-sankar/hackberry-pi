import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#4FC3F7",
        tabBarInactiveTintColor: "#666",
        tabBarStyle: {
          backgroundColor: "#111",
          borderTopColor: "#222",
          height: 85,
          paddingBottom: 30,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        headerStyle: { backgroundColor: "#111" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Setup",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="assist"
        options={{
          title: "Live",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="eye-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="replay"
        options={{
          title: "Replay",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="film-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="debug"
        options={{
          title: "Debug",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="terminal-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="pi"
        options={{
          title: "Pi",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pulse-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
