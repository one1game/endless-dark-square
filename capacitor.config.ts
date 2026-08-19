import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.endlessdarksquare.game",
  appName: "Endless Dark Square",
  webDir: "dist/public",
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
  },
};

export default config;
