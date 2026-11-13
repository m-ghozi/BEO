import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerForPushNotificationsAsync } from "./notifications";

const mockDevice = jest.requireMock("expo-device") as { isDevice: boolean };
const mockConstants = (
  jest.requireMock("expo-constants") as {
    default: {
      expoConfig?: { extra?: { eas?: { projectId?: string } } };
      easConfig?: { projectId?: string };
    };
  }
).default;

describe("notifications service", () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDevice.isDevice = true;
    Object.defineProperty(Platform, "OS", {
      value: "ios",
      configurable: true,
    });
    mockConstants.expoConfig = {
      extra: { eas: { projectId: "eas-project-123" } },
    };
    mockConstants.easConfig = { projectId: "eas-fallback-456" };
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "granted",
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "granted",
    });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
      data: "ExponentPushToken[test-token]",
    });
  });

  afterAll(() => {
    Object.defineProperty(Platform, "OS", {
      value: originalPlatformOS,
      configurable: true,
    });
  });

  it("returns null when not running on a physical device", async () => {
    jest.resetModules();
    jest.doMock("expo-device", () => ({ isDevice: false }));
    const {
      registerForPushNotificationsAsync: registerOnSimulator,
    } = require("./notifications") as typeof import("./notifications");

    const token = await registerOnSimulator();

    expect(token).toBeNull();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("requests permission when not granted and returns null if denied", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "undetermined",
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "denied",
    });

    const token = await registerForPushNotificationsAsync();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(token).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("requests permission when undetermined, sets android channel, and returns Expo push token", async () => {
    Object.defineProperty(Platform, "OS", {
      value: "android",
      configurable: true,
    });
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "undetermined",
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "granted",
    });

    const token = await registerForPushNotificationsAsync();

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        importance: Notifications.AndroidImportance.MAX,
      })
    );
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "eas-project-123",
    });
    expect(token).toBe("ExponentPushToken[test-token]");
  });

  it("falls back to easConfig.projectId and omits projectId when neither is set", async () => {
    mockConstants.expoConfig = { extra: { eas: { projectId: "" } } };
    await registerForPushNotificationsAsync();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "eas-fallback-456",
    });

    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "granted",
    });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
      data: "ExponentPushToken[no-project]",
    });
    mockConstants.expoConfig = undefined;
    mockConstants.easConfig = undefined;

    const token = await registerForPushNotificationsAsync();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith(undefined);
    expect(token).toBe("ExponentPushToken[no-project]");
  });

  it("catches errors from getExpoPushTokenAsync and returns null", async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
      new Error("FCM unavailable")
    );

    const token = await registerForPushNotificationsAsync();

    expect(token).toBeNull();
  });
});
