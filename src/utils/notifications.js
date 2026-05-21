import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// 알림 표시 방식 설정 (앱 포그라운드에서도 알림 표시)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// 푸시 토큰 등록 및 Firestore에 저장
export async function registerPushToken(uid) {
  if (!Device.isDevice) return null; // 에뮬레이터는 FCM 토큰 미지원

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    // Android 알림 채널 설정
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('schedule', {
        name: '일정 알림',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#e94560',
      });
    }

    const token = (await Notifications.getDevicePushTokenAsync()).data;
    if (!token || !uid) return null;

    // Firestore users/{uid}에 토큰 저장
    await updateDoc(doc(db, 'users', uid), { pushToken: token });
    return token;
  } catch (e) {
    console.warn('푸시 토큰 등록 실패:', e);
    return null;
  }
}
