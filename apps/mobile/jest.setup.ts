jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
    },
    __store: store,
  };
});

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { MAX: 5 },
}));

jest.mock("expo-device", () => ({
  isDevice: true,
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: {
          projectId: "test-eas-project-id",
        },
      },
    },
    easConfig: {
      projectId: "test-eas-project-id",
    },
  },
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  Link: "Link",
  Redirect: "Redirect",
  Stack: "Stack",
  Tabs: Object.assign("Tabs", { Screen: "TabsScreen" }),
}));

jest.mock("expo-linking", () => ({
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  parse: jest.fn((url: string) => {
    try {
      const queryIndex = url.indexOf("?");
      const queryParams: Record<string, string> = {};
      if (queryIndex !== -1) {
        const params = new URLSearchParams(url.slice(queryIndex + 1));
        params.forEach((value, key) => {
          queryParams[key] = value;
        });
      }
      return { queryParams };
    } catch {
      return { queryParams: {} };
    }
  }),
}));

jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { View } = require("react-native");
  return function MockQRCode(props: { value: string; testID?: string; size?: number }) {
    return React.createElement(View, {
      testID: props.testID ?? "qr-code",
      accessibilityLabel: props.value,
    });
  };
});
