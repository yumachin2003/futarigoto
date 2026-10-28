import { useState, useEffect, useRef } from "react";
import {
  Container, Paper, Title, Text, Button, Group, Stack,
  SegmentedControl, TextInput, ActionIcon, Badge, Checkbox,
  Divider, Card, Center, Loader, Box, Alert
} from "@mantine/core";
import {
  IconPlus, IconTrash, IconCheck, IconLogout,
  IconBrandGoogle, IconDiscount2,
  IconUpload, IconDownload
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
import { exportExpensesToCsv } from "./utils/csvHelper";


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
  const [showSettled, setShowSettled] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const handleImportSuccess = (count) => {
    setFeedbackMessage(`${count}件の履歴をインポートしました！`);
    setTimeout(() => {
      setFeedbackMessage("");
    }, 4500);
  };

  const [authError, setAuthError] = useState("");
  const googleBtnRef = useRef(null);

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
  const addRow = (isPartner) => {
    if (isPartner) setPartnerItems([...partnerItems, newRow()]);
    else setSharedItems([...sharedItems, newRow()]);
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
      setStore("");
      setPartnerItems([newRow()]);
      setSharedItems([newRow()]);
    } catch (err) {
      alert("保存エラー: " + err.message);
    } finally {
      setSubmitting(false);
    }
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

  // 6. 一括精算
  const handleSettleAll = async () => {
    if (!window.confirm(`未精算の ${unsettled.length} 件をすべて精算済にしますか？`)) return;
    const batch = writeBatch(db);
    unsettled.forEach((ex) => batch.update(doc(db, "expenses", ex.id), { isSettled: true }));
    await batch.commit();
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

  const displayed = showSettled ? expenses : unsettled;

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
        paddingTop: "max(32px, calc(env(safe-area-inset-top, 0px) + 20px))",
        paddingBottom: "max(80px, calc(env(safe-area-inset-bottom, 0px) + 80px))",
      }}
    >
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" align="center">
          <img
            src={futarigotoLogo}
            alt="Futarigoto"
            style={{
              width: 40,
              objectFit: "contain",
              display: "block",
              margin: "-16px -12px -16px -8px",
              filter: "invert(53%) sepia(51%) saturate(767%) hue-rotate(174deg) brightness(92%) contrast(87%)",
            }}
          />
          <Title order={3} style={{ fontFamily: '"LTTurbo", sans-serif', fontSize: "2rem",margin: "9px" }}>Futarigoto</Title>
          <Badge c="white" bg="blue" radius="xl" p="xs">beta</Badge>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            p="xs"
            leftSection={<IconLogout size={14} />}
            onClick={() => {
              setDebugUser(null);
              signOut(auth);
            }}
          >
            ログアウト
          </Button>
        </Group>
      </Group>

      <Paper withBorder shadow="sm" p="md" radius="lg" mb="lg" bg="blue.0">
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

      <Paper withBorder shadow="xs" p="md" radius="lg" mb="xl">
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <SegmentedControl
              fullWidth size="md" value={payer} onChange={setPayer}
              color={payer === "yuma" ? "blue" : "pink"}
              data={payerOptions}
            />
            <TextInput label="日付" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} required />
            <TextInput label="店舗｜購入品目" value={store} onChange={(e) => setStore(e.currentTarget.value)} required />

            <Divider my="xs" label={`【${payer === "yuma" ? "はのん" : "ゆうま"}の分】（100%請求）`} labelPosition="left" />
            {partnerItems.map((item, idx) => (
              <Stack key={item.id} gap={4}>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    type="number"
                    inputMode="numeric"
                    placeholder={`金額 ${idx + 1}`}
                    value={item.amount}
                    onChange={(e) => updateRow(true, item.id, "amount", e.currentTarget.value)}
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
                          placeholder={item.discountType === "percent" ? "割引率 (例: 20)" : "値引額 (例: 50)"}
                          value={item.discountValue || ""}
                          onChange={(e) => updateRow(true, item.id, "discountValue", e.currentTarget.value)}
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
                    type="number"
                    inputMode="numeric"
                    placeholder={`金額 ${idx + 1}`}
                    value={item.amount}
                    onChange={(e) => updateRow(false, item.id, "amount", e.currentTarget.value)}
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
                          placeholder={item.discountType === "percent" ? "割引率 (例: 20)" : "値引額 (例: 50)"}
                          value={item.discountValue || ""}
                          onChange={(e) => updateRow(false, item.id, "discountValue", e.currentTarget.value)}
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

      {feedbackMessage && (
        <Alert
          color="teal"
          icon={<IconCheck size={16} />}
          radius="md"
          mb="md"
          withCloseButton
          onClose={() => setFeedbackMessage("")}
        >
          {feedbackMessage}
        </Alert>
      )}

      <Group justify="space-between" mb="xs" align="center">
        <Title order={4}>履歴（{displayed.length}件）</Title>
        <Checkbox label="精算済も表示" checked={showSettled} onChange={(e) => setShowSettled(e.currentTarget.checked)} size="xs" />
      </Group>

      <Group justify="flex-start" mb="sm" gap="xs">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconUpload size={14} />}
          onClick={() => setImportModalOpen(true)}
        >
          CSVインポート
        </Button>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconDownload size={14} />}
          onClick={() => exportExpensesToCsv(expenses)}
          disabled={expenses.length === 0}
        >
          CSVエクスポート
        </Button>
      </Group>

      <Stack gap="xs">
        {displayed.map((ex) => {
          const pTotal = Math.round((ex.partnerAmounts?.inTax || 0) + (ex.partnerAmounts?.tax8 || 0) * 1.08 + (ex.partnerAmounts?.tax10 || 0) * 1.1);
          const sTotal = Math.round((ex.sharedAmounts?.inTax || 0) + (ex.sharedAmounts?.tax8 || 0) * 1.08 + (ex.sharedAmounts?.tax10 || 0) * 1.1);
          return (
            <Card key={ex.id} withBorder radius="lg" p="sm" opacity={ex.isSettled ? 0.6 : 1}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ flex: 1 }}>
                  <Checkbox checked={ex.isSettled} onChange={() => updateDoc(doc(db, "expenses", ex.id), { isSettled: !ex.isSettled })} />
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
                <ActionIcon color="gray" variant="subtle" onClick={() => window.confirm(`「${ex.store}」を削除しますか？`) && deleteDoc(doc(db, "expenses", ex.id))}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Card>
          );
        })}
      </Stack>

      <CsvImportModal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        currentUser={currentUser}
        db={db}
        onImportSuccess={handleImportSuccess}
      />
    </Container>
  );
}