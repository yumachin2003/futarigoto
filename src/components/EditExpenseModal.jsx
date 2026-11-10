import { useState, useEffect } from "react";
import {
  Modal, TextInput, Button, Group, Stack, SegmentedControl,
  Divider, ActionIcon, Paper, Badge, Text
} from "@mantine/core";
import { IconPlus, IconTrash, IconDiscount2 } from "@tabler/icons-react";
import { doc, updateDoc } from "firebase/firestore";
import { addActivityLog } from "../utils/logHelper";

const createRow = (amount = "", taxType = "tax8") => ({
  id: crypto.randomUUID(),
  amount: amount ? String(amount) : "",
  taxType,
  hasDiscount: false,
  discountType: "amount",
  discountValue: "",
});

export default function EditExpenseModal({
  opened,
  onClose,
  expense,
  currentUser,
  db,
}) {
  const [date, setDate] = useState("");
  const [store, setStore] = useState("");
  const [payer, setPayer] = useState("yuma");
  const [partnerItems, setPartnerItems] = useState([createRow()]);
  const [sharedItems, setSharedItems] = useState([createRow()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!expense || !opened) return;

    setDate(expense.date || new Date().toISOString().split("T")[0]);
    setStore(expense.store || "");
    setPayer(expense.payer || "yuma");

    // Convert stored amounts to row items
    // partnerAmounts: { inTax, tax8, tax10 }
    const pRows = [];
    if (expense.partnerAmounts?.tax8 > 0) {
      pRows.push(createRow(expense.partnerAmounts.tax8, "tax8"));
    }
    if (expense.partnerAmounts?.tax10 > 0) {
      pRows.push(createRow(expense.partnerAmounts.tax10, "tax10"));
    }
    if (expense.partnerAmounts?.inTax > 0) {
      pRows.push(createRow(expense.partnerAmounts.inTax, "inTax"));
    }
    setPartnerItems(pRows.length > 0 ? pRows : [createRow()]);

    const sRows = [];
    if (expense.sharedAmounts?.tax8 > 0) {
      sRows.push(createRow(expense.sharedAmounts.tax8, "tax8"));
    }
    if (expense.sharedAmounts?.tax10 > 0) {
      sRows.push(createRow(expense.sharedAmounts.tax10, "tax10"));
    }
    if (expense.sharedAmounts?.inTax > 0) {
      sRows.push(createRow(expense.sharedAmounts.inTax, "inTax"));
    }
    setSharedItems(sRows.length > 0 ? sRows : [createRow()]);
  }, [expense, opened]);

  const addRow = (isPartner) => {
    const row = createRow();
    if (isPartner) setPartnerItems((prev) => [...prev, row]);
    else setSharedItems((prev) => [...prev, row]);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!expense?.id) return;

    const pAmt = sumByTax(partnerItems);
    const sAmt = sumByTax(sharedItems);
    const total = pAmt.inTax + pAmt.tax8 + pAmt.tax10 + sAmt.inTax + sAmt.tax8 + sAmt.tax10;

    if (!store.trim()) return alert("店舗｜購入品目を入力してね！");
    if (total === 0) return alert("金額を1つ以上入力してね！");

    setSubmitting(true);
    try {
      await updateDoc(doc(db, "expenses", expense.id), {
        date,
        store: store.trim(),
        payer,
        partnerAmounts: pAmt,
        sharedAmounts: sAmt,
        updatedAt: Date.now(),
      });

      const pTotal = Math.round((pAmt.inTax || 0) + (pAmt.tax8 || 0) * 1.08 + (pAmt.tax10 || 0) * 1.1);
      const sTotal = Math.round((sAmt.inTax || 0) + (sAmt.tax8 || 0) * 1.08 + (sAmt.tax10 || 0) * 1.1);
      const totalAmount = pTotal + sTotal;
      const payerName = payer === "yuma" ? "ゆうま" : "はのん";
      const userRole = currentUser === "hanon" ? "hanon" : "yuma";
      const userName = currentUser === "hanon" ? "はのん" : "ゆうま";

      addActivityLog(db, {
        type: "edit",
        userRole,
        userName,
        summary: `「${store.trim()}」（${date}）の支出を編集しました（${payerName}立替 / 合計 ¥${totalAmount.toLocaleString()}）`,
        meta: {
          store: store.trim(),
          date,
          payer,
          totalAmount,
          partnerTotal: pTotal,
          sharedTotal: sTotal,
        },
      });

      onClose();
    } catch (err) {
      alert("更新エラー: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

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
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>支出の編集</Text>}
      radius="lg"
      size="md"
      centered
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <SegmentedControl
            fullWidth
            size="md"
            value={payer}
            onChange={setPayer}
            color={payer === "yuma" ? "blue" : "pink"}
            data={payerOptions}
          />
          <TextInput
            label="日付"
            type="date"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
            required
          />
          <TextInput
            label="メモ（店舗・購入品目など）"
            value={store}
            onChange={(e) => setStore(e.currentTarget.value)}
            required
          />

          <Divider
            my="xs"
            label={`【${payer === "yuma" ? "はのん" : "ゆうま"}の分】（100%請求）`}
            labelPosition="left"
          />
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
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size="md"
                    onClick={() => removeRow(true, item.id)}
                  >
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
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => addRow(true)}
          >
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
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size="md"
                    onClick={() => removeRow(false, item.id)}
                  >
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
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => addRow(false)}
          >
            追加
          </Button>

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={submitting}>
              キャンセル
            </Button>
            <Button type="submit" loading={submitting}>
              更新する
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

