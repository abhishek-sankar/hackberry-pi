import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AssistProvider } from "../contexts/AssistContext";
import { PiProvider } from "../contexts/PiContext";

export default function RootLayout() {
  return (
    <PiProvider>
      <AssistProvider>
        <ThemeProvider value={DarkTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
          <StatusBar style="light" />
        </ThemeProvider>
      </AssistProvider>
    </PiProvider>
  );
}
