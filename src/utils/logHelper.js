import { collection, addDoc, serverTimestamp } from "firebase/firestore";

/**
 * 操作ログを追加する
 * @param {import("firebase/firestore").Firestore} db
 * @param {Object} params
 * @param {'add'|'edit'|'settle'|'unsettle'|'settle_all'|'delete'|'import'} params.type
 * @param {'yuma'|'hanon'} params.userRole
 * @param {string} params.userName
 * @param {string} params.summary
 * @param {Object} [params.meta]
 */
export async function addActivityLog(db, { type, userRole, userName, summary, meta = {} }) {
  try {
    if (!db) return;
    await addDoc(collection(db, "activity_logs"), {
      type,
      userRole: userRole || "yuma",
      userName: userName || (userRole === "hanon" ? "はのん" : "ゆうま"),
      summary,
      meta,
      createdAt: Date.now(),
      serverCreatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to add activity log:", err);
  }
}

