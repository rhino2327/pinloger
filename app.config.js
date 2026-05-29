module.exports = {
  expo: {
    name: "PINLOGER",
    slug: "TravelApp",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    scheme: "pinloger",
    jsEngine: "hermes",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#1a1a2e",
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.travelapp.planner",
      buildNumber: "1",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSLocationWhenInUseUsageDescription:
          "여행 일정에 장소를 추가하고 지도에서 위치를 확인하기 위해 위치 정보를 사용합니다.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "여행 일정에 장소를 추가하고 지도에서 위치를 확인하기 위해 위치 정보를 사용합니다.",
        NSCameraUsageDescription:
          "프로필 사진 및 여행 사진 첨부를 위해 카메라를 사용합니다.",
        NSPhotoLibraryUsageDescription:
          "여행 사진을 앱에 추가하기 위해 사진 보관함에 접근합니다.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-android.png",
        monochromeImage: "./assets/adaptive-icon-android.png",
        backgroundColor: "#1a1a2e",
      },
      package: "com.travelapp.planner",
      versionCode: 1,
      edgeToEdgeEnabled: true,
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "RECEIVE_BOOT_COMPLETED",
        "VIBRATE",
      ],
      // Uses EAS file env var on CI, falls back to local file in dev
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-font",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "여행 일정에 장소를 추가하고 지도에서 위치를 확인하기 위해 위치 정보를 사용합니다.",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#e94560",
          sounds: [],
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "2eeaa40c-c686-4c88-8d02-212fa9dd0ea6",
      },
    },
  },
};
