const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * 対象ユーザー宛ての有効なFCMトークンを取得
 * @param {string} targetRole "yuma" | "hanon"
 */
async function getTokensForRole(targetRole) {
  const snapshot = await admin
    .firestore()
    .collection("fcmTokens")
    .where("userRole", "==", targetRole)
    .get();

  const tokens = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.token) {
      tokens.push(data.token);
    }
  });

  return tokens;
}

/**
 * 宛先トークン一覧へ通知を一斉送信し、無効なトークンがあればクリーンアップ
 */
async function sendPushNotification(tokens, { title, body, data = {} }) {
  if (!tokens || tokens.length === 0) {
    console.log("送信先トークンがありません。スキップします。");
    return;
  }

  const message = {
    notification: {
      title,
      body,
    },
    data: {
      ...data,
      click_action: "/",
    },
    webpush: {
      notification: {
        icon: "/apple-touch-icon.png",
        badge: "/apple-touch-icon.png",
      },
      fcmOptions: {
        link: "/",
      },
    },
    tokens,
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  console.log(`送信結果: 成功 ${response.successCount} 件, 失敗 ${response.failureCount} 件`);

  // 無効なトークンを削除
  if (response.failureCount > 0) {
    const cleanupPromises = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errCode = resp.error?.code;
        if (
          errCode === "messaging/invalid-registration-token" ||
          errCode === "messaging/registration-token-not-registered"
        ) {
          const badToken = tokens[idx];
          cleanupPromises.push(
            admin.firestore().collection("fcmTokens").doc(badToken).delete()
          );
        }
      }
    });
    if (cleanupPromises.length > 0) {
      await Promise.all(cleanupPromises);
    }
  }
}

/**
 * 1. 精算（出費）が新しく追加された時のトリガー
 */
exports.onExpenseCreated = onDocumentCreated(
  {
    document: "expenses/{expenseId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();
    const payer = data.payer; // "yuma" | "hanon"
    const store = data.store ? `（${data.store}）` : "";
    const totalAmount = data.totalAmount || 0;

    // 通知の送信先は「支払った本人ではない相手」
    const targetRole = payer === "hanon" ? "yuma" : "hanon";
    const senderName = payer === "hanon" ? "はのん" : "ゆうま";

    const title = `${senderName}が精算を追加しました`;
    const body = `${store} ¥${Number(totalAmount).toLocaleString()} の精算が追加されました。`;

    const tokens = await getTokensForRole(targetRole);
    await sendPushNotification(tokens, {
      title,
      body,
      data: {
        type: "expense_created",
        expenseId: event.params.expenseId,
      },
    });
  }
);

/**
 * 2. 精算済み（isSettled: true）になった時のトリガー
 */
exports.onExpenseUpdated = onDocumentUpdated(
  {
    document: "expenses/{expenseId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // isSettled が false から true に変化した時のみ通知
    if (!beforeData.isSettled && afterData.isSettled) {
      const payer = afterData.payer;
      // 精算完了時は、精算対象の両者に通知、または支払った人宛てに通知
      // 一般的には「立て替えてくれた人」に「精算完了したよ」と伝えるのが自然
      const targetRole = payer; 
      const targetName = targetRole === "hanon" ? "はのん" : "ゆうま";
      const totalAmount = afterData.totalAmount || 0;

      const title = `精算が完了しました！`;
      const body = `¥${Number(totalAmount).toLocaleString()} の精算が「精算済み」になりました。`;

      // 相手側にも双方にも届くよう、targetRole宛てに送信
      const tokens = await getTokensForRole(targetRole);
      await sendPushNotification(tokens, {
        title,
        body,
        data: {
          type: "expense_settled",
          expenseId: event.params.expenseId,
        },
      });
    }
  }
);

