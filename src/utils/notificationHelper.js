import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { app, db } from "../FirebaseConfig";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Service Worker を登録し、Firebase設定を送信
 */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    
    // SW がアクティブになったら設定をポスト
    const sendConfig = (sw) => {
      if (sw) {
        sw.postMessage({
          type: "INIT_FIREBASE_CONFIG",
          config: firebaseConfig,
        });
      }
    };

    if (registration.active) {
      sendConfig(registration.active);
    } else {
      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "activated") {
              sendConfig(installingWorker);
            }
          });
        }
      });
    }

    return registration;
  } catch (error) {
    console.error("Service Worker 登録失敗:", error);
    return null;
  }
}

/**
 * プッシュ通知がサポートされているか確認
 */
export async function checkNotificationSupport() {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * 通知の許可をリクエストし、FCMトークンを取得してFirestoreに保存
 * @param {string} userRole "yuma" | "hanon"
 * @param {string} userUid ユーザーのUID
 */
export async function requestNotificationPermission(userRole, userUid) {
  const supported = await checkNotificationSupport();
  if (!supported) {
    throw new Error("お使いのブラウザまたは環境（PWA未追加など）ではプッシュ通知がサポートされていません。");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知が許可されませんでした。設定から通知を許可してください。");
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    throw new Error("Service Worker の登録に失敗しました。");
  }

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    throw new Error("VAPIDキーが設定されていません。.env を確認してください。");
  }

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    serviceWorkerRegistration: registration,
    vapidKey,
  });

  if (!token) {
    throw new Error("プッシュ通知トークンの取得に失敗しました。");
  }

  // Firestore の fcmTokens コレクションに保存
  await setDoc(
    doc(db, "fcmTokens", token),
    {
      token,
      userRole,
      uid: userUid,
      device: /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : "other",
      isStandalone: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return token;
}

/**
 * フォアグラウンドメッセージのリスナー登録
 */
export function setupForegroundMessageListener(onMessageReceived) {
  checkNotificationSupport().then((supported) => {
    if (!supported) return;
    try {
      const messaging = getMessaging(app);
      onMessage(messaging, (payload) => {
        if (onMessageReceived) {
          onMessageReceived(payload);
        }
      });
    } catch (e) {
      console.warn("Foreground message setup failed:", e);
    }
  });
}
