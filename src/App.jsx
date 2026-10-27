import { useState, useEffect } from "react";
import {
  Container, Paper, Title, Text, Box, Button, Group, Stack,
  SegmentedControl, TextInput, ActionIcon, Badge, Checkbox,
  Divider, Card, Center, Loader
} from "@mantine/core";
import {
  IconPlus, IconTrash, IconCheck, IconLogout,
  IconBrandGoogle, IconReceipt2
} from "@tabler/icons-react";
import {
  collection, addDoc, onSnapshot, query, orderBy,
  writeBatch, doc, updateDoc, deleteDoc
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { db, auth, googleProvider } from "./FirebaseConfig";


const newRow = () => ({ id: crypto.randomUUID(), amount: "", taxType: "tax8" });

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [store, setStore] = useState("");
  const [payer, setPayer] = useState("yuma");
  const [partnerItems, setPartnerItems] = useState([newRow()]);
  const [sharedItems, setSharedItems] = useState([newRow()]);
  const [submitting, setSubmitting] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [showSettled, setShowSettled] = useState(false);

  // 1. ログイン監視
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
  }, []);

  // 2. Firestoreリアルタイム取得
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "expenses"), orderBy("date", "desc"));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      setExpenses(list);
    });
  }, [user]);

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

  const sumByTax = (items) =>
    items.reduce(
      (acc, x) => ({ ...acc, [x.taxType]: acc[x.taxType] + (Number(x.amount) || 0) }),
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

  // 6. 一括精算・初期データ投入
  const handleSettleAll = async () => {
    if (!window.confirm(`未精算の ${unsettled.length} 件をすべて精算済にしますか？`)) return;
    const batch = writeBatch(db);
    unsettled.forEach((ex) => batch.update(doc(db, "expenses", ex.id), { isSettled: true }));
    await batch.commit();
  };

  if (authLoading) return <Center h="100vh"><Loader size="lg" /></Center>;

  if (!user) {
    return (
      <Container size="xs" py="xl">
        <Paper withBorder shadow="sm" p="xl" radius="md" ta="center">
          <IconReceipt2 size={48} color="#228be6" />
          <Title order={2} mt="sm">futarigoto</Title>
          <Text c="dimmed" size="sm" mt="xs" mb="xl">ふたりの立替計算簿</Text>
          <Button fullWidth size="md" leftSection={<IconBrandGoogle size={20} />} onClick={() => signInWithPopup(auth, googleProvider)}>
            Googleでログイン
          </Button>
        </Paper>
      </Container>
    );
  }

  const displayed = showSettled ? expenses : unsettled;

  return (
    <Container
      size="xs"
      style={{
        paddingTop: "max(32px, calc(env(safe-area-inset-top, 0px) + 20px))",
        paddingBottom: "max(80px, calc(env(safe-area-inset-bottom, 0px) + 80px))",
      }}
    >
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconReceipt2 size={24} color="#228be6" />
          <Title order={3}>futarigoto</Title>
          <Badge c="white" bg="blue" radius="lg" p="xs">beta</Badge>
        </Group>
        <Button variant="subtle" color="gray" size="xs" leftSection={<IconLogout size={14} />} onClick={() => signOut(auth)}>
          ログアウト
        </Button>
      </Group>

      <Paper withBorder shadow="sm" p="md" radius="md" mb="lg" bg="blue.0">
        <Group justify="space-between" mb={4}>
          <Text size="xs" c="dimmed">ゆうま立替: ¥{yumaClaim.toLocaleString()}</Text>
          <Text size="xs" c="dimmed">はのん立替: ¥{hanonClaim.toLocaleString()}</Text>
        </Group>
        <Title order={3} ta="center" my="sm" c={diff === 0 ? "gray.7" : "blue.9"}>
          {diff > 0 ? `はのん → ゆうま に ¥${diff.toLocaleString()}` : diff < 0 ? `ゆうま → はのん に ¥${Math.abs(diff).toLocaleString()}` : "精算なし（¥0）"}
        </Title>
        {unsettled.length > 0 && (
          <Button fullWidth color="teal" leftSection={<IconCheck size={18} />} onClick={handleSettleAll} mt="xs">
            すべて精算済にする（{unsettled.length}件）
          </Button>
        )}
      </Paper>

      <Paper withBorder shadow="xs" p="md" radius="md" mb="xl">
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <SegmentedControl
              fullWidth size="md" value={payer} onChange={setPayer}
              color={payer === "yuma" ? "blue" : "pink"}
              data={[{ label: "🙋‍♂️ ゆうま支払い", value: "yuma" }, { label: "🙋‍♀️ はのん支払い", value: "hanon" }]}
            />
            <TextInput label="日付" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} required />
            <TextInput label="店舗｜購入品目" placeholder="例：ツルヤ｜野菜、牛乳など" value={store} onChange={(e) => setStore(e.currentTarget.value)} required />

            <Divider my="xs" label={`【${payer === "yuma" ? "はのん" : "ゆうま"}の分】（100%請求）`} labelPosition="left" />
            {partnerItems.map((item, idx) => (
              <Group key={item.id} gap="xs" wrap="nowrap">
                <TextInput type="number" inputMode="numeric" placeholder={`金額 ${idx + 1}`} value={item.amount} onChange={(e) => updateRow(true, item.id, "amount", e.currentTarget.value)} style={{ flex: 1 }} />
                <SegmentedControl size="xs" value={item.taxType} onChange={(val) => updateRow(true, item.id, "taxType", val)} data={[{ label: "8%", value: "tax8" }, { label: "10%", value: "tax10" }, { label: "内税", value: "inTax" }]} />
                {partnerItems.length > 1 && (
                  <ActionIcon color="red" variant="subtle" onClick={() => removeRow(true, item.id)}><IconTrash size={16} /></ActionIcon>
                )}
              </Group>
            ))}
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => addRow(true)}>
              相手の分の金額欄を追加
            </Button>

            <Divider my="xs" label="【共有物品】（50%折半）" labelPosition="left" />
            {sharedItems.map((item, idx) => (
              <Group key={item.id} gap="xs" wrap="nowrap">
                <TextInput type="number" inputMode="numeric" placeholder={`金額 ${idx + 1}`} value={item.amount} onChange={(e) => updateRow(false, item.id, "amount", e.currentTarget.value)} style={{ flex: 1 }} />
                <SegmentedControl size="xs" value={item.taxType} onChange={(val) => updateRow(false, item.id, "taxType", val)} data={[{ label: "8%", value: "tax8" }, { label: "10%", value: "tax10" }, { label: "内税", value: "inTax" }]} />
                {sharedItems.length > 1 && (
                  <ActionIcon color="red" variant="subtle" onClick={() => removeRow(false, item.id)}><IconTrash size={16} /></ActionIcon>
                )}
              </Group>
            ))}
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => addRow(false)}>
              共有物品の金額欄を追加
            </Button>

            <Button type="submit" size="md" fullWidth mt="sm" loading={submitting}>記録する</Button>
          </Stack>
        </form>
      </Paper>

      <Group justify="space-between" mb="sm">
        <Title order={4}>履歴（{displayed.length}件）</Title>
        <Checkbox label="精算済も表示" checked={showSettled} onChange={(e) => setShowSettled(e.currentTarget.checked)} size="xs" />
      </Group>

      <Stack gap="xs">
        {displayed.map((ex) => {
          const pTotal = Math.round((ex.partnerAmounts?.inTax || 0) + (ex.partnerAmounts?.tax8 || 0) * 1.08 + (ex.partnerAmounts?.tax10 || 0) * 1.1);
          const sTotal = Math.round((ex.sharedAmounts?.inTax || 0) + (ex.sharedAmounts?.tax8 || 0) * 1.08 + (ex.sharedAmounts?.tax10 || 0) * 1.1);
          return (
            <Card key={ex.id} withBorder radius="md" p="sm" opacity={ex.isSettled ? 0.6 : 1}>
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
    </Container>
  );
}