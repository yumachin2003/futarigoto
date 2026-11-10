import { useState, useEffect } from "react";
import {
  Modal, Timeline, Text, Badge, Group, Stack, SegmentedControl,
  Center, Loader, Paper, Box
} from "@mantine/core";
import {
  IconHistory, IconPlus, IconCheck, IconChecks,
  IconTrash, IconRotate2, IconUpload, IconPencil
} from "@tabler/icons-react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

/**
 * 相対時刻または整形された日時文字列を返す
 * @param {number} timestamp
 */
function formatTime(timestamp) {
  if (!timestamp) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) return "たった今";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;

  const date = new Date(timestamp);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return `昨日 ${hh}:${mm}`;
  if (diffDay === 2) return `一昨日 ${hh}:${mm}`;

  return `${m}/${d} ${hh}:${mm}`;
}

const TYPE_CONFIG = {
  add: {
    label: "追加",
    color: "teal",
    icon: <IconPlus size={14} />,
  },
  edit: {
    label: "編集",
    color: "blue",
    icon: <IconPencil size={14} />,
  },
  settle: {
    label: "精算済",
    color: "blue",
    icon: <IconCheck size={14} />,
  },
  unsettle: {
    label: "精算解除",
    color: "orange",
    icon: <IconRotate2 size={14} />,
  },
  settle_all: {
    label: "一括精算",
    color: "cyan",
    icon: <IconChecks size={14} />,
  },
  delete: {
    label: "削除",
    color: "red",
    icon: <IconTrash size={14} />,
  },
  import: {
    label: "インポート",
    color: "grape",
    icon: <IconUpload size={14} />,
  },
};

export default function ActivityLogModal({ opened, onClose, db }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!opened || !db) return;
    setLoading(true);

    const q = query(
      collection(db, "activity_logs"),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setLogs(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching activity logs:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [opened, db]);

  const filteredLogs = logs.filter((log) => {
    if (filter === "settle") {
      return log.type === "settle" || log.type === "unsettle" || log.type === "settle_all";
    }
    if (filter === "expense") {
      return log.type === "add" || log.type === "edit" || log.type === "delete";
    }
    if (filter === "import") {
      return log.type === "import";
    }
    return true;
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconHistory size={22} color="#4A8BDB" />
          <Text fw={700} size="md">
            操作ログ
          </Text>
        </Group>
      }
      size="md"
      radius="lg"
      centered
    >
      <Stack gap="sm">
        <SegmentedControl
          size="xs"
          fullWidth
          value={filter}
          onChange={setFilter}
          data={[
            { label: "すべて", value: "all" },
            { label: "追加・削除", value: "expense" },
            { label: "精算", value: "settle" },
            { label: "インポート", value: "import" },
          ]}
        />

        {loading ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : filteredLogs.length === 0 ? (
          <Paper p="xl" withBorder radius="md" ta="center" bg="gray.0" my="md">
            <Text size="sm" c="dimmed">
              操作ログはまだありません
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              データの追加や精算を行うと、ここに履歴が表示されます
            </Text>
          </Paper>
        ) : (
          <Box style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }} mt="xs">
            <Timeline active={-1} bulletSize={22} lineWidth={2}>
              {filteredLogs.map((log) => {
                const config = TYPE_CONFIG[log.type] || {
                  label: "その他",
                  color: "gray",
                  icon: <IconHistory size={14} />,
                };

                return (
                  <Timeline.Item
                    key={log.id}
                    bullet={config.icon}
                    color={config.color}
                    title={
                      <Group gap="xs" wrap="nowrap" align="center">
                        <Badge
                          size="xs"
                          color={log.userRole === "hanon" ? "pink" : "blue"}
                          variant="filled"
                        >
                          {log.userName || (log.userRole === "hanon" ? "はのん" : "ゆうま")}
                        </Badge>
                        <Badge size="xs" color={config.color} variant="light">
                          {config.label}
                        </Badge>
                        <Text size="xs" c="dimmed" style={{ marginLeft: "auto", flexShrink: 0 }}>
                          {formatTime(log.createdAt)}
                        </Text>
                      </Group>
                    }
                  >
                    <Text size="sm" mt={4} style={{ wordBreak: "break-word" }}>
                      {log.summary}
                    </Text>
                    {log.meta?.store && (
                      <Group gap="xs" mt={4}>
                        {log.meta.date && (
                          <Text size="xs" c="dimmed">
                            日付: {log.meta.date}
                          </Text>
                        )}
                        {log.meta.payer && (
                          <Text size="xs" c="dimmed">
                            支払: {log.meta.payer === "hanon" ? "はのん" : "ゆうま"}
                          </Text>
                        )}
                        {typeof log.meta.totalAmount === "number" && log.meta.totalAmount > 0 && (
                          <Text size="xs" fw={600} c="dark.3">
                            ¥{log.meta.totalAmount.toLocaleString()}
                          </Text>
                        )}
                      </Group>
                    )}
                  </Timeline.Item>
                );
              })}
            </Timeline>
          </Box>
        )}
      </Stack>
    </Modal>
  );
}

