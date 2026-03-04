export const DEFAULT_CHAT_LOG_MAX_MESSAGES = 200;

export function getChatOverflowCount(
  entryCount: number,
  maxEntries: number,
): number {
  const normalizedEntryCount = Math.max(0, Math.floor(entryCount));
  const normalizedMaxEntries = Math.max(0, Math.floor(maxEntries));
  return Math.max(0, normalizedEntryCount - normalizedMaxEntries);
}
