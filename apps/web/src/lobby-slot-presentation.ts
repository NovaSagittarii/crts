const SLOT_COLOR_PALETTE = [
  'var(--team-a)',
  'var(--team-b)',
  'var(--team-c)',
  'var(--team-d)',
  'var(--team-e)',
  'var(--team-f)',
] as const;

export function getLobbySlotLabel(slotId: string): string {
  const numberedTeamMatch = /^team-(\d+)$/i.exec(slotId.trim());
  if (numberedTeamMatch) {
    return `Team ${numberedTeamMatch[1]}`;
  }

  return slotId;
}

export function getLobbySlotColor(slotId: string, index = 0): string {
  const numberedTeamMatch = /^team-(\d+)$/i.exec(slotId.trim());
  if (numberedTeamMatch) {
    const numericIndex = Number.parseInt(numberedTeamMatch[1] ?? '1', 10) - 1;
    return SLOT_COLOR_PALETTE[
      ((numericIndex % SLOT_COLOR_PALETTE.length) + SLOT_COLOR_PALETTE.length) %
        SLOT_COLOR_PALETTE.length
    ];
  }

  return (
    SLOT_COLOR_PALETTE[index % SLOT_COLOR_PALETTE.length] ?? 'var(--accent)'
  );
}
