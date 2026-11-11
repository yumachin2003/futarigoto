import { Modal, Text, Button, Stack, ThemeIcon, Group, Paper } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";

export default function AddSuccessModal({
  opened,
  onClose,
  onContinue,
  onView,
  lastExpense,
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      withCloseButton={false}
      size="sm"
      padding="lg"
    >
      <Stack align="center" gap="md" py="xs">
        <ThemeIcon color="teal" size={56} radius="xl" variant="light">
          <IconCheck size={32} stroke={2.5} />
        </ThemeIcon>

        <Stack gap={4} align="center">
          <Text fw={700} size="lg">
            清算を追加しました！
          </Text>
          {lastExpense?.store && (
            <Paper p="xs" px="md" radius="md" bg="var(--mantine-color-default-hover)" withBorder mt="xs" style={{ width: "100%" }}>
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  {lastExpense.store}
                </Text>
                {typeof lastExpense.totalAmount === "number" && (
                  <Text size="sm" fw={700} c="blue.5">
                    ¥{lastExpense.totalAmount.toLocaleString()}
                  </Text>
                )}
              </Group>
              {lastExpense.date && (
                <Text size="xs" c="dimmed" mt={2}>
                  日付: {lastExpense.date} / 支払: {lastExpense.payer === "hanon" ? "はのん" : "ゆうま"}
                </Text>
              )}
            </Paper>
          )}
        </Stack>

        <Stack gap="xs" style={{ width: "100%" }} mt="xs">
          <Button
            variant="filled"
            color="blue"
            size="md"
            fullWidth
            onClick={onView}
          >
            追加した清算を表示
          </Button>
          <Button
            variant="light"
            color="gray"
            size="md"
            fullWidth
            onClick={onContinue}
          >
            続けて追加
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}

