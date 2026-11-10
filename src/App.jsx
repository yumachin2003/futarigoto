import { useState, useEffect, useRef } from "react";
import {
  Container, Paper, Title, Text, Button, Group, Stack,
  SegmentedControl, TextInput, ActionIcon, Badge, Checkbox,
  Divider, Card, Center, Loader, Box, Alert, UnstyledButton,
  ThemeIcon, Avatar
} from "@mantine/core";
import {
  IconPlus, IconTrash, IconCheck, IconLogout,
  IconBrandGoogle, IconDiscount2,
  IconUpload, IconDownload, IconHistory,
  IconReceipt, IconCirclePlus, IconDots,
  IconFileSpreadsheet, IconUser, IconPencil,
  IconBell, IconBellRinging
} from "@tabler/icons-react";
import {
  collection, addDoc, onSnapshot, query, orderBy,
  writeBatch, doc, updateDoc, deleteDoc
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { db, auth, googleProvider } from "./FirebaseConfig";
import paperGrid from "./assets/paper-grid.webp";
import futarigotoIcon from "./assets/futarigoto_icon_blue.svg";
import futarigotoLogo from "./assets/futarigoto_logo_small.svg";
import CsvImportModal from "./components/CsvImportModal";
import ActivityLogModal from "./components/ActivityLogModal";
import AddSuccessModal from "./components/AddSuccessModal";
import EditExpenseModal from "./components/EditExpenseModal";
import { exportExpensesToCsv } from "./utils/csvHelper";
import { addActivityLog } from "./utils/logHelper";
import {
  registerServiceWorker,
  requestNotificationPermission,
  setupForegroundMessageListener,
} from "./utils/notificationHelper";


const newRow = () => ({
  id: crypto.randomUUID(),
  amount: "",
  taxType: "tax8",
  hasDiscount: false,
  discountType: "amount",
  discountValue: "",
});

const isDebugHanon = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "hanon";

export default function App() {
  const [user, setUser] = useState(null);
  const [debugUser, setDebugUser] = useState(() =>
    isDebugHanon ? { uid: "debug-hanon", displayName: "はのん", email: "muranakahanon@gmail.com" } : null
  );
  const [authLoading, setAuthLoading] = useState(true);

  const activeUser = user || debugUser;

  const [currentUser, setCurrentUser] = useState(() => {
    if (isDebugHanon) return "hanon";
    return localStorage.getItem("futarigoto_current_user") || "yuma";
  });

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [store, setStore] = useState("");
  const [payer, setPayer] = useState(() => {
    if (isDebugHanon) return "hanon";
    return localStorage.getItem("futarigoto_current_user") || "yuma";
  });
  const [partnerItems, setPartnerItems] = useState([newRow()]);
  const [sharedItems, setSharedItems] = useState([newRow()]);
  const [submitting, setSubmitting] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("history"); // "history" | "add" | "more"
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [addSuccessModalOpen, setAddSuccessModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [lastAddedExpense, setLastAddedExpense] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const userRole = currentUser === "hanon" ? "hanon" : "yuma";
  const userName = currentUser === "hanon" ? "はのん" : "ゆうま";

  const handleImportSuccess = (count) => {
    setFeedbackMessage(`${count}件の履歴をインポートしました！`);
    addActivityLog(db, {
      type: "import",
      userRole,
      userName,
      summary: `CSVから ${count} 件の履歴をインポートしました`,
      meta: { count },
    });
    setTimeout(() => {
      setFeedbackMessage("");
    }, 4500);
  };

  const [notificationStatus, setNotificationStatus] = useState("default"); // "default" | "granted" | "denied" | "unsupported"
  const [notificationLoading, setNotificationLoading] = useState(false);

  // 通知状態の初期確認 & ServiceWorker登録
  useEffect(() => {
    registerServiceWorker();
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationStatus(Notification.permission);
    } else {
      setNotificationStatus("unsupported");
    }

    // フォアグラウンドメッセージ受信時のハンドラ
    setupForegroundMessageListener((payload) => {
      const title = payload.notification?.title || payload.data?.title || "ふたりごと";
      const body = payload.notification?.body || payload.data?.body || "";
      setFeedbackMessage(`🔔 ${title}: ${body}`);
      setTimeout(() => setFeedbackMessage(""), 5000);
    });
  }, []);

  const handleEnableNotification = async () => {
    try {
      setNotificationLoading(true);
      await requestNotificationPermission(userRole, activeUser?.uid || "anonymous");
      setNotificationStatus("granted");
      setFeedbackMessage("プッシュ通知を有効にしました！");
      setTimeout(() => setFeedbackMessage(""), 4000);
    } catch (err) {
      console.error(err);
      alert(err.message || "通知の有効化に失敗しました");
      if (typeof window !== "undefined" && "Notification" in window) {
        setNotificationStatus(Notification.permission);
      }
    } finally {
      setNotificationLoading(false);
    }
  };

  const [authError, setAuthError] = useState("");
  const googleBtnRef = useRef(null);
  const amountInputRefs = useRef({});
  const pendingFocusId = useRef(null);

  useEffect(() => {
    if (pendingFocusId.current) {
      const input = amountInputRefs.current[pendingFocusId.current];
      if (input) {
        input.focus();
      }
      pendingFocusId.current = null;
    }
  }, [partnerItems, sharedItems]);

  // 1. ログイン監視
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        const isHanon = u.email === "muranakahanon@gmail.com" || isDebugHanon;
        const initialUser = isHanon ? "hanon" : "yuma";
        setCurrentUser(initialUser);
        setPayer(initialUser);
        localStorage.setItem("futarigoto_current_user", initialUser);
      }
    });
  }, []);

  // Google Identity Services (GIS) ボタン初期化
  useEffect(() => {
    if (activeUser || authLoading) return;

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    const initGsi = () => {
      if (typeof window === "undefined" || !window.google?.accounts?.id || !googleBtnRef.current) return false;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            setAuthError("");
            const credential = GoogleAuthProvider.credential(response.credential);
            await signInWithCredential(auth, credential);
          } catch (err) {
            console.error("GIS Sign-In Error:", err);
            setAuthError("ログインに失敗しました: " + (err.message || ""));
          }
        },
      });

      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        type: "standard",
        shape: "pill",
        text: "signin_with",
        logo_alignment: "left",
        width: 280,
      });

      return true;
    };

    if (!initGsi()) {
      const timer = setInterval(() => {
        if (initGsi()) clearInterval(timer);
      }, 200);
      return () => clearInterval(timer);
    }
  }, [activeUser, authLoading]);


  // 2. Firestoreリアルタイム取得
  useEffect(() => {
    if (!activeUser) return;
    const q = query(collection(db, "expenses"), orderBy("date", "desc"));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      setExpenses(list);
    });
  }, [activeUser]);

  // 3. 入力欄の増殖・更新・削除
  const addRow = (isPartner, shouldFocus = false) => {
    const row = newRow();
    if (shouldFocus) {
      pendingFocusId.current = row.id;
    }
    if (isPartner) setPartnerItems((prev) => [...prev, row]);
    else setSharedItems((prev) => [...prev, row]);
  };

  const handleAmountKeyDown = (e, isPartner) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addRow(isPartner, true);
    }
  };

  const updateRow = (isPartner, id, field, value) => {
    const fn = (items) => items.map((x) => (x.id === id ? { ...x, [field]: value } : x));
    if (isPartner) setPartnerItems(fn);
    else setSharedItems(fn);
  };

  const removeRow = (isPartner, id) => {
    if (isPartner && partnerItems.length > 1) setPartnerItems(partnerItems.filter((x) => x.id !== id));
    if (!isPartner && sharedItems.length > 1) setSharedItems(sharedItems.filter((x) => x.id !== id));
  };

  const toggleDiscount = (isPartner, id) => {
    const fn = (items) =>
      items.map((x) =>
        x.id === id
          ? {
              ...x,
              hasDiscount: !x.hasDiscount,
              discountValue: x.hasDiscount ? "" : x.discountValue,
            }
          : x
      );
    if (isPartner) setPartnerItems(fn);
    else setSharedItems(fn);
  };

  const getEffectiveAmount = (item) => {
    const base = Number(item.amount) || 0;
    if (!item.hasDiscount || !item.discountValue) return base;
    const disc = Number(item.discountValue) || 0;
    if (item.discountType === "percent") {
      return Math.max(0, Math.round(base * (1 - disc / 100)));
    }
    return Math.max(0, base - disc);
  };

  const sumByTax = (items) =>
    items.reduce(
      (acc, x) => {
        const amt = getEffectiveAmount(x);
        return { ...acc, [x.taxType]: acc[x.taxType] + amt };
      },
      { inTax: 0, tax8: 0, tax10: 0 }
    );

  // 4. 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();
    const pAmt = sumByTax(partnerItems);
    const sAmt = sumByTax(sharedItems);
    const total = pAmt.inTax + pAmt.tax8 + pAmt.tax10 + sAmt.inTax + sAmt.tax8 + sAmt.tax10;

    if (!store.trim()) return alert("店舗｜購入品目を入力してね！");
    if (total === 0) return alert("金額を1つ以上入力してね！");

    setSubmitting(true);
    try {
      await addDoc(collection(db, "expenses"), {
        date,
        store: store.trim(),
        payer,
        partnerAmounts: pAmt,
        sharedAmounts: sAmt,
        isSettled: false,
        createdAt: Date.now(),
      });

      const pTotal = Math.round((pAmt.inTax || 0) + (pAmt.tax8 || 0) * 1.08 + (pAmt.tax10 || 0) * 1.1);
      const sTotal = Math.round((sAmt.inTax || 0) + (sAmt.tax8 || 0) * 1.08 + (sAmt.tax10 || 0) * 1.1);
      const totalAmount = pTotal + sTotal;
      const payerName = payer === "yuma" ? "ゆうま" : "はのん";

      addActivityLog(db, {
        type: "add",
        userRole,
        userName,
        summary: `「${store.trim()}」（${date}）の支出を記録しました（${payerName}立替 / 合計 ¥${totalAmount.toLocaleString()}）`,
        meta: {
          store: store.trim(),
          date,
          payer,
          totalAmount,
          partnerTotal: pTotal,
          sharedTotal: sTotal,
        },
      });

      setLastAddedExpense({
        store: store.trim(),
        totalAmount,
        date,
        payer,
      });
      setAddSuccessModalOpen(true);

      setStore("");
      setPartnerItems([newRow()]);
      setSharedItems([newRow()]);
    } catch (err) {
      alert("保存エラー: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueAdd = () => {
    setAddSuccessModalOpen(false);
  };

  const handleViewAdded = () => {
    setAddSuccessModalOpen(false);
    setHistoryFilter("all");
    setActiveTab("history");
  };

  // 5. 集計計算（Excelと完全一致）
  const unsettled = expenses.filter((ex) => !ex.isSettled);
  const sum = {
    yuma: { pIn: 0, p8: 0, p10: 0, sIn: 0, s8: 0, s10: 0 },
    hanon: { pIn: 0, p8: 0, p10: 0, sIn: 0, s8: 0, s10: 0 },
  };

  unsettled.forEach((ex) => {
    const t = ex.payer === "yuma" ? sum.yuma : sum.hanon;
    t.pIn += ex.partnerAmounts?.inTax || 0;
    t.p8 += ex.partnerAmounts?.tax8 || 0;
    t.p10 += ex.partnerAmounts?.tax10 || 0;
    t.sIn += ex.sharedAmounts?.inTax || 0;
    t.s8 += ex.sharedAmounts?.tax8 || 0;
    t.s10 += ex.sharedAmounts?.tax10 || 0;
  });

  const yumaClaim = Math.round(
    sum.yuma.pIn + sum.yuma.p8 * 1.08 + sum.yuma.p10 * 1.1 +
    (sum.yuma.sIn + sum.yuma.s8 * 1.08 + sum.yuma.s10 * 1.1) / 2
  );
  const hanonClaim = Math.round(
    sum.hanon.pIn + sum.hanon.p8 * 1.08 + sum.hanon.p10 * 1.1 +
    (sum.hanon.sIn + sum.hanon.s8 * 1.08 + sum.hanon.s10 * 1.1) / 2
  );
  const diff = yumaClaim - hanonClaim;

  // 6. 精算・操作系
  const handleToggleSettled = async (ex) => {
    const nextSettled = !ex.isSettled;
    try {
      await updateDoc(doc(db, "expenses", ex.id), { isSettled: nextSettled });
      const p = Math.round((ex.partnerAmounts?.inTax || 0) + (ex.partnerAmounts?.tax8 || 0) * 1.08 + (ex.partnerAmounts?.tax10 || 0) * 1.1);
      const s = Math.round((ex.sharedAmounts?.inTax || 0) + (ex.sharedAmounts?.tax8 || 0) * 1.08 + (ex.sharedAmounts?.tax10 || 0) * 1.1);

      addActivityLog(db, {
        type: nextSettled ? "settle" : "unsettle",
        userRole,
        userName,
        summary: nextSettled
          ? `「${ex.store}」（${ex.date}）を精算済にしました`
          : `「${ex.store}」（${ex.date}）を未精算に戻しました`,
        meta: {
          store: ex.store,
          date: ex.date,
          payer: ex.payer,
          totalAmount: p + s,
        },
      });
    } catch (err) {
      alert("更新エラー: " + err.message);
    }
  };

  const handleSettleAll = async () => {
    const count = unsettled.length;
    if (count === 0) return;
    if (!window.confirm(`未精算の ${count} 件をすべて精算済にしますか？`)) return;
    try {
      const batch = writeBatch(db);
      unsettled.forEach((ex) => batch.update(doc(db, "expenses", ex.id), { isSettled: true }));
      await batch.commit();

      addActivityLog(db, {
        type: "settle_all",
        userRole,
        userName,
        summary: `未精算の支出 ${count} 件を一括精算済にしました`,
        meta: { count },
      });
    } catch (err) {
      alert("精算エラー: " + err.message);
    }
  };

  const handleDeleteExpense = async (ex) => {
    if (!window.confirm(`「${ex.store}」を削除しますか？`)) return;
    try {
      await deleteDoc(doc(db, "expenses", ex.id));
      const p = Math.round((ex.partnerAmounts?.inTax || 0) + (ex.partnerAmounts?.tax8 || 0) * 1.08 + (ex.partnerAmounts?.tax10 || 0) * 1.1);
      const s = Math.round((ex.sharedAmounts?.inTax || 0) + (ex.sharedAmounts?.tax8 || 0) * 1.08 + (ex.sharedAmounts?.tax10 || 0) * 1.1);

      addActivityLog(db, {
        type: "delete",
        userRole,
        userName,
        summary: `「${ex.store}」（${ex.date}）の支出を削除しました`,
        meta: {
          store: ex.store,
          date: ex.date,
          payer: ex.payer,
          totalAmount: p + s,
        },
      });
    } catch (err) {
      alert("削除エラー: " + err.message);
    }
  };

  if (authLoading) return <Center h="100vh"><Loader size="lg" /></Center>;

  // 未ログイン状態
  if (!activeUser) {
    return (
      <Container size="xs" py="xl">
        <Box
          pos="relative"
          ta="center"
          style={{
            aspectRatio: "953 / 1037",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            // 左はリング穴、上はテープの分だけ余白を広めに
            padding: "14% 7% 7% 13%",
            isolation: "isolate",
          }}
        >
          <img
            src={paperGrid}
            alt=""
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              zIndex: -1,
              filter: "drop-shadow(0 8px 14px rgba(0, 0, 0, 0.18))",
            }}
          />
          <img
            src={futarigotoIcon}
            alt="Futarigoto"
            style={{
              width: 110,
              objectFit: "contain",
              animation: "floatInIcon 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
              display: "inline-block",
            }}
          />
          <Title order={2} mt="sm" style={{ fontFamily: '"LTTurbo", sans-serif', fontSize: "5rem", lineHeight: 1.15 }}>
            {"Futarigoto".split("").map((char, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  // Safariはアニメーション中、はみ出た字形を箱で切るので余白で広げてマージンで相殺
                  padding: "0.25em 0.5em",
                  margin: "-0.25em -0.5em",
                  animation: "floatInChar 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
                  animationDelay: `${0.1 + i * 0.05}s`,
                }}
              >
                {char}
              </span>
            ))}
          </Title>
          <Text c="dimmed" size="lg" mt="xs" mb="xl">
            {"ふたりの立替計算簿".split("").map((char, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  animation: "floatInChar 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
                  animationDelay: `${0.45 + i * 0.04}s`,
                }}
              >
                {char}
              </span>
            ))}
          </Text>
          {authError && (
            <Alert color="red" mb="md" withCloseButton onClose={() => setAuthError("")}>
              {authError}
            </Alert>
          )}

          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 48,
              animation: "floatInButton 0.65s cubic-bezier(0.16, 1, 0.3, 1) both",
              animationDelay: "0.8s",
            }}
          >
            <div
              ref={googleBtnRef}
              style={{
                display: "inline-flex",
                justifyContent: "center",
                borderRadius: 9999,
                boxShadow: "0 4px 14px 0 rgba(0, 0, 0, 0.1), 0 1px 3px 0 rgba(0, 0, 0, 0.08)",
                transition: "box-shadow 0.2s ease, transform 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 6px 20px 0 rgba(0, 0, 0, 0.15), 0 2px 6px 0 rgba(0, 0, 0, 0.1)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "0 4px 14px 0 rgba(0, 0, 0, 0.1), 0 1px 3px 0 rgba(0, 0, 0, 0.08)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            />

            {/* VITE_GOOGLE_CLIENT_ID が未設定またはスクリプト読込待機用のフォールバック */}
            {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <Button
                fullWidth
                size="md"
                leftSection={<IconBrandGoogle size={20} />}
                onClick={() => signInWithPopup(auth, googleProvider)}
              >
                Googleでログイン
              </Button>
            )}
          </Box>
        </Box>
      </Container>
    );
  }

  const displayed = expenses.filter((ex) => {
    if (historyFilter === "unsettled") return !ex.isSettled;
    if (historyFilter === "settled") return ex.isSettled;
    return true;
  });

  const payerOptions =
    currentUser === "hanon"
      ? [
          { label: "はのん支払い", value: "hanon" },
          { label: "ゆうま支払い", value: "yuma" },
        ]
      : [
          { label: "ゆうま支払い", value: "yuma" },
          { label: "はのん支払い", value: "hanon" },
        ];

  return (
    <Container
      size="xs"
      style={{
        paddingTop: 0,
        paddingBottom: "max(96px, calc(env(safe-area-inset-bottom, 0px) + 96px))",
      }}
    >
      {/* 共通ヘッダー */}
      <Box
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          backgroundColor: "var(--mantine-color-body, #fff)",
          paddingTop: "max(12px, calc(env(safe-area-inset-top, 0px) + 8px))",
          paddingBottom: "8px",
          margin: "0 -16px 8px -16px",
          paddingLeft: "16px",
          paddingRight: "16px",
        }}
      >
        <Group justify="space-between" wrap="nowrap" align="center">
          <Group gap="xs" wrap="nowrap" align="center">
            <img
              src={futarigotoLogo}
              alt="Futarigoto"
              style={{
                width: 36,
                objectFit: "contain",
                display: "block",
                margin: "-12px -8px -12px -4px",
                filter: "invert(53%) sepia(51%) saturate(767%) hue-rotate(174deg) brightness(92%) contrast(87%)",
              }}
            />
            <Title order={3} style={{ fontFamily: '"LTTurbo", sans-serif', fontSize: "1.8rem", margin: "4px" }}>
              Futarigoto
            </Title>
            <Badge c="white" bg="blue" radius="xl" size="sm">beta</Badge>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Avatar
              src={activeUser?.photoURL}
              size="sm"
              radius="xl"
              imageProps={{ referrerPolicy: "no-referrer" }}
            />
          </Group>
        </Group>
      </Box>

      {/* タブ1: 履歴 */}
      {activeTab === "history" && (
        <Box>
          {/* 上部に固定する立替状況 */}
          <Box
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              backgroundColor: "var(--mantine-color-body, #fff)",
              paddingTop: 4,
              paddingBottom: 8,
              marginBottom: 8,
            }}
          >
            <Paper withBorder shadow="sm" p="md" radius="lg" bg="blue.0">
              <Group justify="space-between" mb={4}>
                {currentUser === "hanon" ? (
                  <>
                    <Text size="xs" c="dimmed">はのん立替: ¥{hanonClaim.toLocaleString()}</Text>
                    <Text size="xs" c="dimmed">ゆうま立替: ¥{yumaClaim.toLocaleString()}</Text>
                  </>
                ) : (
                  <>
                    <Text size="xs" c="dimmed">ゆうま立替: ¥{yumaClaim.toLocaleString()}</Text>
                    <Text size="xs" c="dimmed">はのん立替: ¥{hanonClaim.toLocaleString()}</Text>
                  </>
                )}
              </Group>
              <Title order={3} ta="center" my="sm" c={diff === 0 ? "gray.7" : "blue.9"}>
                {diff > 0 ? `はのん が ゆうま に ${diff.toLocaleString()}円支払う` : diff < 0 ? `ゆうま が はのん に ¥${Math.abs(diff).toLocaleString()}円支払う` : "精算なし（¥0）"}
              </Title>
              {unsettled.length > 0 && (
                <Button fullWidth color="teal" leftSection={<IconCheck size={18} />} onClick={handleSettleAll} mt="xs">
                  すべて精算済にする（{unsettled.length}件）
                </Button>
              )}
            </Paper>
          </Box>

          <Group justify="space-between" mb="xs" align="center" wrap="wrap" gap="xs">
            <Title order={4}>履歴（{displayed.length}件）</Title>
            <SegmentedControl
              size="xs"
              value={historyFilter}
              onChange={setHistoryFilter}
              data={[
                { label: "すべて", value: "all" },
                { label: "精算前", value: "unsettled" },
                { label: "精算済", value: "settled" },
              ]}
            />
          </Group>

          {displayed.length === 0 ? (
            <Paper p="xl" withBorder radius="lg" ta="center" bg="gray.0" my="md">
              <Text size="sm" c="dimmed">
                {historyFilter === "unsettled"
                  ? "精算前の支出はありません"
                  : historyFilter === "settled"
                  ? "精算済の支出はありません"
                  : "履歴はまだありません"}
              </Text>
            </Paper>
          ) : (
            <Stack gap="xs">
              {displayed.map((ex) => {
                const pTotal = Math.round((ex.partnerAmounts?.inTax || 0) + (ex.partnerAmounts?.tax8 || 0) * 1.08 + (ex.partnerAmounts?.tax10 || 0) * 1.1);
                const sTotal = Math.round((ex.sharedAmounts?.inTax || 0) + (ex.sharedAmounts?.tax8 || 0) * 1.08 + (ex.sharedAmounts?.tax10 || 0) * 1.1);
                return (
                  <Card key={ex.id} withBorder radius="lg" p="sm" opacity={ex.isSettled ? 0.6 : 1}>
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ flex: 1 }}>
                        <Checkbox checked={ex.isSettled} onChange={() => handleToggleSettled(ex)} />
                        <div style={{ flex: 1 }}>
                          <Group gap="xs" mb={2}>
                            <Badge size="xs" color={ex.payer === "yuma" ? "blue" : "pink"}>{ex.payer === "yuma" ? "ゆうま払" : "はのん払"}</Badge>
                            <Text size="xs" c="dimmed">{ex.date}</Text>
                            {ex.isSettled && <Badge size="xs" color="gray" variant="outline">精算済</Badge>}
                          </Group>
                          <Text size="sm" fw={600}>{ex.store}</Text>
                          <Group gap="md" mt={4}>
                            {pTotal > 0 && <Text size="xs" c="dimmed">相手分: ¥{pTotal.toLocaleString()}</Text>}
                            {sTotal > 0 && <Text size="xs" c="dimmed">共有: ¥{sTotal.toLocaleString()} (半額 ¥{Math.round(sTotal / 2).toLocaleString()})</Text>}
                          </Group>
                        </div>
                      </Group>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon color="blue" variant="subtle" onClick={() => setEditingExpense(ex)} title="編集">
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon color="gray" variant="subtle" onClick={() => handleDeleteExpense(ex)} title="削除">
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Box>
      )}

      {/* タブ2: 追加 */}
      {activeTab === "add" && (
        <Box>
          <Paper withBorder shadow="xs" p="md" radius="lg">
            <form onSubmit={handleSubmit}>
              <Stack gap="sm">
                <SegmentedControl
                  fullWidth size="md" value={payer} onChange={setPayer}
                  color={payer === "yuma" ? "blue" : "pink"}
                  data={payerOptions}
                />
                <TextInput label="日付" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} required />
                <TextInput label="メモ（店舗・購入品目など）" value={store} onChange={(e) => setStore(e.currentTarget.value)} required />

                <Divider my="xs" label={`【${payer === "yuma" ? "はのん" : "ゆうま"}の分】（100%請求）`} labelPosition="left" />
                {partnerItems.map((item, idx) => (
                  <Stack key={item.id} gap={4}>
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        ref={(el) => {
                          amountInputRefs.current[item.id] = el;
                        }}
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="next"
                        placeholder={`金額 ${idx + 1}`}
                        value={item.amount}
                        onChange={(e) => updateRow(true, item.id, "amount", e.currentTarget.value)}
                        onKeyDown={(e) => handleAmountKeyDown(e, true)}
                        style={{ flex: 1 }}
                      />
                      <SegmentedControl
                        size="xs"
                        value={item.taxType}
                        onChange={(val) => updateRow(true, item.id, "taxType", val)}
                        data={[
                          { label: "8%", value: "tax8" },
                          { label: "10%", value: "tax10" },
                          { label: "内税", value: "inTax" },
                        ]}
                      />
                      <ActionIcon
                        variant={item.hasDiscount ? "filled" : "light"}
                        color={item.hasDiscount ? "orange" : "gray"}
                        size="md"
                        radius="md"
                        onClick={() => toggleDiscount(true, item.id)}
                        title="値引きあり"
                      >
                        <IconDiscount2 size={16} />
                      </ActionIcon>
                      {partnerItems.length > 1 && (
                        <ActionIcon color="red" variant="subtle" size="md" onClick={() => removeRow(true, item.id)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                    {item.hasDiscount && (
                      <Paper p="xs" radius="md" bg="orange.0" withBorder>
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
                            <SegmentedControl
                              size="xs"
                              value={item.discountType || "amount"}
                              onChange={(val) => updateRow(true, item.id, "discountType", val)}
                              data={[
                                { label: "円引", value: "amount" },
                                { label: "%引", value: "percent" },
                              ]}
                            />
                            <TextInput
                              size="xs"
                              type="number"
                              inputMode="numeric"
                              enterKeyHint="next"
                              placeholder={item.discountType === "percent" ? "割引率 (例: 20)" : "値引額 (例: 50)"}
                              value={item.discountValue || ""}
                              onChange={(e) => updateRow(true, item.id, "discountValue", e.currentTarget.value)}
                              onKeyDown={(e) => handleAmountKeyDown(e, true)}
                              style={{ flex: 1 }}
                            />
                          </Group>
                          {item.amount && item.discountValue ? (
                            <Badge color="orange" variant="light" size="sm">
                              ¥{getEffectiveAmount(item).toLocaleString()}
                            </Badge>
                          ) : null}
                        </Group>
                      </Paper>
                    )}
                  </Stack>
                ))}
                <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => addRow(true)}>
                  追加
                </Button>

                <Divider my="xs" label="【共有物品】（50%折半）" labelPosition="left" />
                {sharedItems.map((item, idx) => (
                  <Stack key={item.id} gap={4}>
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        ref={(el) => {
                          amountInputRefs.current[item.id] = el;
                        }}
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="next"
                        placeholder={`金額 ${idx + 1}`}
                        value={item.amount}
                        onChange={(e) => updateRow(false, item.id, "amount", e.currentTarget.value)}
                        onKeyDown={(e) => handleAmountKeyDown(e, false)}
                        style={{ flex: 1 }}
                      />
                      <SegmentedControl
                        size="xs"
                        value={item.taxType}
                        onChange={(val) => updateRow(false, item.id, "taxType", val)}
                        data={[
                          { label: "8%", value: "tax8" },
                          { label: "10%", value: "tax10" },
                          { label: "内税", value: "inTax" },
                        ]}
                      />
                      <ActionIcon
                        variant={item.hasDiscount ? "filled" : "light"}
                        color={item.hasDiscount ? "orange" : "gray"}
                        size="md"
                        radius="md"
                        onClick={() => toggleDiscount(false, item.id)}
                        title="値引きあり"
                      >
                        <IconDiscount2 size={16} />
                      </ActionIcon>
                      {sharedItems.length > 1 && (
                        <ActionIcon color="red" variant="subtle" size="md" onClick={() => removeRow(false, item.id)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                    {item.hasDiscount && (
                      <Paper p="xs" radius="md" bg="orange.0" withBorder>
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
                            <SegmentedControl
                              size="xs"
                              value={item.discountType || "amount"}
                              onChange={(val) => updateRow(false, item.id, "discountType", val)}
                              data={[
                                { label: "円引", value: "amount" },
                                { label: "%引", value: "percent" },
                              ]}
                            />
                            <TextInput
                              size="xs"
                              type="number"
                              inputMode="numeric"
                              enterKeyHint="next"
                              placeholder={item.discountType === "percent" ? "割引率 (例: 20)" : "値引額 (例: 50)"}
                              value={item.discountValue || ""}
                              onChange={(e) => updateRow(false, item.id, "discountValue", e.currentTarget.value)}
                              onKeyDown={(e) => handleAmountKeyDown(e, false)}
                              style={{ flex: 1 }}
                            />
                          </Group>
                          {item.amount && item.discountValue ? (
                            <Badge color="orange" variant="light" size="sm">
                              ¥{getEffectiveAmount(item).toLocaleString()}
                            </Badge>
                          ) : null}
                        </Group>
                      </Paper>
                    )}
                  </Stack>
                ))}
                <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => addRow(false)}>
                  追加
                </Button>

                <Button type="submit" size="md" fullWidth mt="sm" loading={submitting}>記録する</Button>
              </Stack>
            </form>
          </Paper>
        </Box>
      )}

      {/* タブ3: その他 */}
      {activeTab === "more" && (
        <Stack gap="md">
          {feedbackMessage && (
            <Alert
              color="teal"
              icon={<IconCheck size={16} />}
              radius="md"
              withCloseButton
              onClose={() => setFeedbackMessage("")}
            >
              {feedbackMessage}
            </Alert>
          )}

          {/* 操作ログ */}
          <Card withBorder radius="lg" p="md">
            <Group gap="sm" mb="xs">
              <ThemeIcon color="blue" size="lg" radius="md" variant="light">
                <IconHistory size={20} />
              </ThemeIcon>
              <div>
                <Text fw={600} size="sm">操作ログ</Text>
                <Text size="xs" c="dimmed">支出の追加・精算・削除の履歴を確認できます</Text>
              </div>
            </Group>
            <Button
              variant="light"
              color="blue"
              fullWidth
              mt="xs"
              leftSection={<IconHistory size={16} />}
              onClick={() => setLogModalOpen(true)}
            >
              操作ログを見る
            </Button>
          </Card>

          {/* CSVデータ管理 */}
          <Card withBorder radius="lg" p="md">
            <Group gap="sm" mb="xs">
              <ThemeIcon color="teal" size="lg" radius="md" variant="light">
                <IconFileSpreadsheet size={20} />
              </ThemeIcon>
              <div>
                <Text fw={600} size="sm">CSVデータ連携</Text>
                <Text size="xs" c="dimmed">履歴の一括取り込みやバックアップ出力</Text>
              </div>
            </Group>
            <Group grow mt="xs">
              <Button
                variant="light"
                leftSection={<IconUpload size={16} />}
                onClick={() => setImportModalOpen(true)}
              >
                CSVインポート
              </Button>
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={() => exportExpensesToCsv(expenses)}
                disabled={expenses.length === 0}
              >
                CSVエクスポート
              </Button>
            </Group>
          </Card>

          {/* プッシュ通知設定 */}
          <Card withBorder radius="lg" p="md">
            <Group gap="sm" mb="xs">
              <ThemeIcon
                color={notificationStatus === "granted" ? "teal" : "blue"}
                size="lg"
                radius="md"
                variant="light"
              >
                {notificationStatus === "granted" ? (
                  <IconBellRinging size={20} />
                ) : (
                  <IconBell size={20} />
                )}
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Group justify="space-between" align="center">
                  <Text fw={600} size="sm">プッシュ通知</Text>
                  {notificationStatus === "granted" && (
                    <Badge size="xs" color="teal" variant="light">有効</Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {notificationStatus === "granted"
                    ? "相手が精算を追加・完了した際に通知されます"
                    : "相手が追加した時や精算完了の通知を受け取れます"}
                </Text>
              </div>
            </Group>
            {notificationStatus !== "granted" && (
              <Button
                fullWidth
                mt="xs"
                variant="light"
                color="blue"
                size="xs"
                loading={notificationLoading}
                leftSection={<IconBell size={14} />}
                onClick={handleEnableNotification}
              >
                通知を有効にする
              </Button>
            )}
          </Card>

          {/* アカウント情報 */}
          <Card withBorder radius="lg" p="md">
            <Group gap="sm" mb="xs">
              {activeUser?.photoURL ? (
                <Avatar
                  src={activeUser.photoURL}
                  size="lg"
                  radius="md"
                  imageProps={{ referrerPolicy: "no-referrer" }}
                />
              ) : (
                <ThemeIcon color="gray" size="lg" radius="md" variant="light">
                  <IconUser size={20} />
                </ThemeIcon>
              )}
              <div>
                <Text fw={600} size="sm">アカウント情報</Text>
                <Text size="xs" c="dimmed">{activeUser?.email || "ログイン中"}</Text>
              </div>
            </Group>
            <Group justify="flex-end" mt="md">
              <Button
                variant="subtle"
                color="red"
                size="xs"
                justify="flex-end"
                leftSection={<IconLogout size={14} />}
                onClick={() => {
                  setDebugUser(null);
                  signOut(auth);
                }}
              >
                ログアウト
              </Button>
            </Group>
          </Card>
        </Stack>
      )}

      {/* 画面下のナビゲーションバー */}
      <Box
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid #e9ecef",
          zIndex: 100,
          boxShadow: "0 -2px 10px rgba(0, 0, 0, 0.05)",
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
          paddingTop: "8px",
        }}
      >
        <Container size="xs">
          <Group justify="space-around" grow gap={0}>
            <UnstyledButton
              onClick={() => setActiveTab("history")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 0",
                color: activeTab === "history" ? "#228be6" : "#868e96",
                cursor: "pointer",
                transition: "color 0.15s ease",
              }}
            >
              <IconReceipt size={24} stroke={activeTab === "history" ? 2.3 : 1.8} />
              <Text size="xs" fw={activeTab === "history" ? 700 : 500} mt={2}>
                履歴
              </Text>
            </UnstyledButton>

            <UnstyledButton
              onClick={() => setActiveTab("add")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 0",
                color: activeTab === "add" ? "#228be6" : "#868e96",
                cursor: "pointer",
                transition: "color 0.15s ease",
              }}
            >
              <IconCirclePlus size={24} stroke={activeTab === "add" ? 2.3 : 1.8} />
              <Text size="xs" fw={activeTab === "add" ? 700 : 500} mt={2}>
                追加
              </Text>
            </UnstyledButton>

            <UnstyledButton
              onClick={() => setActiveTab("more")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 0",
                color: activeTab === "more" ? "#228be6" : "#868e96",
                cursor: "pointer",
                transition: "color 0.15s ease",
              }}
            >
              <IconDots size={24} stroke={activeTab === "more" ? 2.3 : 1.8} />
              <Text size="xs" fw={activeTab === "more" ? 700 : 500} mt={2}>
                その他
              </Text>
            </UnstyledButton>
          </Group>
        </Container>
      </Box>

      {/* モーダル群 */}
      <AddSuccessModal
        opened={addSuccessModalOpen}
        onClose={() => setAddSuccessModalOpen(false)}
        onContinue={handleContinueAdd}
        onView={handleViewAdded}
        lastExpense={lastAddedExpense}
      />

      <CsvImportModal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        currentUser={currentUser}
        db={db}
        onImportSuccess={handleImportSuccess}
      />

      <ActivityLogModal
        opened={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        db={db}
      />

      <EditExpenseModal
        opened={Boolean(editingExpense)}
        onClose={() => setEditingExpense(null)}
        expense={editingExpense}
        currentUser={currentUser}
        db={db}
      />
    </Container>
  );
}