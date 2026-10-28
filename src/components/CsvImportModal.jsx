import { useState, useRef } from "react";
import {
  Modal, Button, Group, Stack, Text, Badge, Alert,
  SegmentedControl, Table, ScrollArea, Paper, Collapse, Box,
  Loader, Center
} from "@mantine/core";
import {
  IconFileSpreadsheet, IconUpload, IconDownload, IconCheck,
  IconAlertCircle, IconChevronDown, IconChevronUp,
  IconTrash, IconFileCheck
} from "@tabler/icons-react";
import {
  readCsvFileAsText, parseCsvText, parseExpenseRows,
  downloadCsvTemplate, importExpensesToFirestore
} from "../utils/csvHelper";

export default function CsvImportModal({
  opened,
  onClose,
  currentUser = "yuma",
  db,
  onImportSuccess,
}) {
  const [file, setFile] = useState(null);
  const [rawText, setRawText] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [defaultPayer, setDefaultPayer] = useState(currentUser || "yuma");
  const [settleMode, setSettleMode] = useState("csv"); // 'csv' | 'force_unsettled' | 'force_settled'
  const [showGuide, setShowGuide] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fileInputRef = useRef(null);

  // Parse CSV whenever raw text or options change
  const parsedData = (() => {
    if (!rawText) return null;
    const rows = parseCsvText(rawText);
    return parseExpenseRows(rows, { defaultPayer, settleMode });
  })();

  const resetState = () => {
    setFile(null);
    setRawText("");
    setLoadingFile(false);
    setImporting(false);
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (importing) return;
    resetState();
    onClose();
  };

  const handleProcessFile = async (selectedFile) => {
    if (!selectedFile) return;
    if (!selectedFile.name.toLowerCase().endsWith(".csv") && selectedFile.type !== "text/csv") {
      setErrorMessage("CSVファイル（.csv）を選択してください");
      return;
    }

    setErrorMessage("");
    setLoadingFile(true);
    try {
      const text = await readCsvFileAsText(selectedFile);
      setFile(selectedFile);
      setRawText(text);
    } catch (err) {
      setErrorMessage("ファイルの読み込みに失敗しました: " + err.message);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) handleProcessFile(selected);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleProcessFile(droppedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleExecuteImport = async () => {
    if (!parsedData || parsedData.validCount === 0) return;
    setImporting(true);
    setErrorMessage("");

    try {
      const count = await importExpensesToFirestore(db, parsedData.expenses);
      if (onImportSuccess) {
        onImportSuccess(count);
      }
      handleClose();
    } catch (err) {
      setErrorMessage("インポートエラーが発生しました: " + err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <IconFileSpreadsheet size={22} color="#4A8BDB" />
          <Text fw={700} size="md">CSVから履歴をインポート</Text>
        </Group>
      }
      size="lg"
      radius="lg"
      centered
    >
      <Stack gap="md">
        {errorMessage && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="エラー">
            {errorMessage}
          </Alert>
        )}

        {/* File Dropzone / Picker */}
        {!file && (
          <>
            <Box
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "#4A8BDB" : "#ced4da"}`,
                borderRadius: "14px",
                padding: "32px 16px",
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: dragOver ? "rgba(74, 139, 219, 0.08)" : "#f8f9fa",
                transition: "all 0.2s ease",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              {loadingFile ? (
                <Center>
                  <Loader size="sm" />
                  <Text size="sm" ml="xs">ファイルを解析中...</Text>
                </Center>
              ) : (
                <Stack align="center" gap="xs">
                  <IconUpload size={36} color="#4A8BDB" />
                  <Text fw={600} size="sm">
                    CSVファイルをここにドロップ または クリックして選択
                  </Text>
                  <Text size="xs" c="dimmed">
                    Excel (Shift-JIS) / Googleスプレッドシート (UTF-8) 両方に対応
                  </Text>
                </Stack>
              )}
            </Box>

            <Group justify="space-between" wrap="wrap">
              <Button
                variant="subtle"
                size="xs"
                color="blue"
                leftSection={<IconDownload size={14} />}
                onClick={downloadCsvTemplate}
              >
                テンプレートCSVをダウンロード
              </Button>
              <Button
                variant="subtle"
                size="xs"
                color="gray"
                rightSection={showGuide ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                onClick={() => setShowGuide(!showGuide)}
              >
                フォーマットの仕様を見る
              </Button>
            </Group>

            <Collapse in={showGuide}>
              <Paper p="sm" radius="md" bg="gray.0" withBorder>
                <Text size="xs" fw={700} mb="xs">
                  CSVヘッダー対応仕様
                </Text>
                <Text size="xs" c="dimmed" mb="xs">
                  以下のいずれかのヘッダー名に対応しています。税率ごとの詳細列、または「相手分」「共有」のみの簡易列のどちらでも読み込めます。
                </Text>
                <Stack gap={4}>
                  <Text size="xs">
                    <b>日付:</b> <code>日付</code>, <code>利用日</code>, <code>date</code> （2026-10-25 / 2026/10/25 など）
                  </Text>
                  <Text size="xs">
                    <b>店舗・品目:</b> <code>店舗｜購入品目</code>, <code>店舗</code>, <code>購入品目</code>, <code>店名</code>
                  </Text>
                  <Text size="xs">
                    <b>支払者:</b> <code>支払者</code>, <code>支払い</code>, <code>payer</code> （ゆうま / はのん）
                  </Text>
                  <Text size="xs">
                    <b>相手分:</b> <code>相手分(内税)</code>, <code>相手分(8%)</code>, <code>相手分(10%)</code>、または <code>相手分</code>
                  </Text>
                  <Text size="xs">
                    <b>共有分:</b> <code>共有(内税)</code>, <code>共有(8%)</code>, <code>共有(10%)</code>、または <code>共有</code>
                  </Text>
                  <Text size="xs">
                    <b>精算状態:</b> <code>精算済</code>, <code>精算</code>, <code>isSettled</code> （済 / 未）
                  </Text>
                </Stack>
              </Paper>
            </Collapse>
          </>
        )}

        {/* Parsed Preview & Import Settings */}
        {file && parsedData && (
          <Stack gap="sm">
            <Paper p="xs" radius="md" withBorder bg="blue.0">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ overflow: "hidden" }}>
                  <IconFileCheck size={20} color="#4A8BDB" />
                  <Text size="sm" fw={600} truncate>
                    {file.name}
                  </Text>
                </Group>
                <Button
                  variant="subtle"
                  color="red"
                  size="compact-xs"
                  leftSection={<IconTrash size={12} />}
                  onClick={resetState}
                  disabled={importing}
                >
                  やり直す
                </Button>
              </Group>
            </Paper>

            <Group justify="space-between">
              <Group gap="xs">
                <Badge color="blue" size="md">
                  合計 {parsedData.totalRows} 件
                </Badge>
                <Badge color="teal" size="md">
                  取り込み可能 {parsedData.validCount} 件
                </Badge>
                {parsedData.errorCount > 0 && (
                  <Badge color="orange" size="md">
                    除外 {parsedData.errorCount} 件
                  </Badge>
                )}
              </Group>
            </Group>

            {parsedData.errorCount > 0 && (
              <Alert color="orange" icon={<IconAlertCircle size={14} />} p="xs" radius="md">
                <Text size="xs">
                  店舗名が空、または合計金額が0円の {parsedData.errorCount} 件はインポート対象からスキップされます。
                </Text>
              </Alert>
            )}

            <Paper p="sm" radius="md" withBorder>
              <Stack gap="xs">
                <div>
                  <Text size="xs" fw={600} mb={4}>精算状態の設定</Text>
                  <SegmentedControl
                    fullWidth
                    size="xs"
                    value={settleMode}
                    onChange={setSettleMode}
                    data={[
                      { label: "CSVの指定に従う", value: "csv" },
                      { label: "すべて未精算", value: "force_unsettled" },
                      { label: "すべて精算済", value: "force_settled" },
                    ]}
                  />
                </div>

                <div>
                  <Text size="xs" fw={600} mb={4}>支払者が未指定の場合の既定値</Text>
                  <SegmentedControl
                    fullWidth
                    size="xs"
                    value={defaultPayer}
                    onChange={setDefaultPayer}
                    data={[
                      { label: "ゆうま支払い", value: "yuma" },
                      { label: "はのん支払い", value: "hanon" },
                    ]}
                  />
                </div>
              </Stack>
            </Paper>

            {/* Preview Table */}
            <div>
              <Text size="xs" fw={600} c="dimmed" mb={4}>
                プレビュー（先頭 {Math.min(15, parsedData.expenses.length)} 件）
              </Text>
              <ScrollArea.Autosize mah={220} type="auto">
                <Table striped highlightOnHover withTableBorder withColumnBorders size="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 40 }}>#</Table.Th>
                      <Table.Th style={{ width: 90 }}>日付</Table.Th>
                      <Table.Th>店舗｜品目</Table.Th>
                      <Table.Th style={{ width: 75 }}>支払</Table.Th>
                      <Table.Th style={{ width: 80, textAlign: "right" }}>相手分</Table.Th>
                      <Table.Th style={{ width: 80, textAlign: "right" }}>共有</Table.Th>
                      <Table.Th style={{ width: 65, textAlign: "center" }}>状態</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {parsedData.expenses.slice(0, 15).map((item) => (
                      <Table.Tr
                        key={item.rowIndex}
                        style={{
                          backgroundColor: !item.isValid ? "rgba(255, 107, 107, 0.1)" : undefined,
                        }}
                      >
                        <Table.Td>{item.rowIndex}</Table.Td>
                        <Table.Td>
                          <Text size="xs">{item.date}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={500} truncate maw={140}>
                            {item.store}
                          </Text>
                          {!item.isValid && (
                            <Text size="10px" c="red">
                              {item.errors.join(", ")}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            size="xs"
                            color={item.payer === "yuma" ? "blue" : "pink"}
                          >
                            {item.payer === "yuma" ? "ゆうま" : "はのん"}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text size="xs">
                            {item.pTotal > 0 ? `¥${item.pTotal.toLocaleString()}` : "-"}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text size="xs">
                            {item.sTotal > 0 ? `¥${item.sTotal.toLocaleString()}` : "-"}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "center" }}>
                          {item.isSettled ? (
                            <Badge size="xs" color="gray" variant="outline">
                              精算済
                            </Badge>
                          ) : (
                            <Badge size="xs" color="teal">
                              未精算
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
              {parsedData.expenses.length > 15 && (
                <Text size="11px" c="dimmed" ta="center" mt={4}>
                  他 {parsedData.expenses.length - 15} 件のデータがあります
                </Text>
              )}
            </div>

            {/* Buttons */}
            <Group justify="flex-end" mt="xs">
              <Button
                variant="default"
                size="sm"
                onClick={handleClose}
                disabled={importing}
              >
                キャンセル
              </Button>
              <Button
                color="blue"
                size="sm"
                leftSection={<IconCheck size={16} />}
                onClick={handleExecuteImport}
                loading={importing}
                disabled={parsedData.validCount === 0}
              >
                {parsedData.validCount} 件をインポート
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
