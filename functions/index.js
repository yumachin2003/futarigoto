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

  // 重複トークンを排除
  return [...new Set(tokens)];
}

/**
 * 宛先トークン一覧へ通知を一斉送信し、無効なトークンがあればクリーンアップ
 */
async function sendPushNotification(tokens, { title, body, icon, badge, tag, data = {} }) {
  if (!tokens || tokens.length === 0) {
    console.log("送信先トークンがありません。スキップします。");
    return;
  }

  const uniqueTokens = [...new Set(tokens)];
  const resolvedIcon = icon || "/apple-touch-icon.png";
  const resolvedBadge = badge || "/apple-touch-icon.png";
  const resolvedTag = tag || "futarigoto-notification";

  const message = {
    notification: {
      title,
      body,
    },
    data: {
      ...data,
      title,
      body,
      senderPhotoURL: resolvedIcon,
      tag: resolvedTag,
      click_action: "/",
    },
    webpush: {
      headers: {
        Urgency: "high",
      },
      notification: {
        title,
        body,
        icon: resolvedIcon,
        badge: resolvedBadge,
        tag: resolvedTag,
        renotify: true,
      },
      fcmOptions: {
        link: "/",
      },
    },
    tokens: uniqueTokens,
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
          const badToken = uniqueTokens[idx];
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

    // ログイン中のアカウント（記録者）で判定
    const createdByRole = data.createdByRole || (data.payer === "hanon" ? "hanon" : "yuma");
    const targetRole = createdByRole === "hanon" ? "yuma" : "hanon";
    const senderName = createdByRole === "hanon" ? "はのん" : "ゆうま";
    const senderPhotoURL = data.createdByPhoto || null;

    // 金額の算出
    let totalAmount = data.totalAmount;
    if (typeof totalAmount !== "number") {
      const pAmt = data.partnerAmounts || {};
      const sAmt = data.sharedAmounts || {};
      const pTotal = Math.round((pAmt.inTax || 0) + (pAmt.tax8 || 0) * 1.08 + (pAmt.tax10 || 0) * 1.1);
      const sTotal = Math.round((sAmt.inTax || 0) + (sAmt.tax8 || 0) * 1.08 + (sAmt.tax10 || 0) * 1.1);
      totalAmount = pTotal + sTotal;
    }

    // 指定の通知書式:
    // **<ユーザー名>が清算を追加しました**
    // 金額
    // メモ
    // 日付
    const title = `${senderName}が清算を追加しました`;

    const amountFormatted = `¥${Number(totalAmount).toLocaleString()}`;
    const storeText = data.store ? String(data.store).trim() : "";
    const dateText = data.date ? String(data.date).trim() : "";

    const bodyLines = [amountFormatted];
    if (storeText) bodyLines.push(storeText);
    if (dateText) bodyLines.push(dateText);
    const body = bodyLines.join("\n");

    const tokens = await getTokensForRole(targetRole);
    await sendPushNotification(tokens, {
      title,
      body,
      icon: senderPhotoURL || "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      tag: `expense-${event.params.expenseId}`,
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
      const targetRole = payer; 
      const targetName = targetRole === "hanon" ? "はのん" : "ゆうま";
      const totalAmount = afterData.totalAmount || 0;

      const title = `精算が完了しました！`;
      const body = `¥${Number(totalAmount).toLocaleString()} の精算が「精算済み」になりました。`;

      const tokens = await getTokensForRole(targetRole);
      await sendPushNotification(tokens, {
        title,
        body,
        icon: "/apple-touch-icon.png",
        badge: "/apple-touch-icon.png",
        tag: `expense-settled-${event.params.expenseId}`,
        data: {
          type: "expense_settled",
          expenseId: event.params.expenseId,
        },
      });
    }
  }
);
