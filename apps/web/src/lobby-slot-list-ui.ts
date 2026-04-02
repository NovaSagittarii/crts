import type {
  LobbySlotMemberViewModel,
  LobbySlotViewModel,
} from './lobby-membership-view-model.js';

function createBadge(label: string, className: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`;
  badge.textContent = label;
  return badge;
}

function renderMemberRow(member: LobbySlotMemberViewModel): HTMLElement {
  const item = document.createElement('div');
  item.className = 'slot-member';

  const header = document.createElement('div');
  header.className = 'slot-member__header';

  const title = document.createElement('strong');
  title.textContent = member.displayName;
  header.append(title);

  const badges = document.createElement('div');
  badges.className = 'badge-row';
  if (member.isHost) {
    badges.append(createBadge('Host', 'badge--host'));
  }
  if (member.isBot) {
    badges.append(createBadge('Bot', 'badge--bot'));
  }
  badges.append(
    createBadge(
      member.readyCopy,
      member.readyCopy === 'Ready' ? 'badge--ready' : 'badge--held',
    ),
  );
  if (member.heldLabel) {
    badges.append(createBadge(member.heldLabel, 'badge--held'));
  }

  const meta = document.createElement('div');
  meta.className = 'slot-meta';
  meta.textContent = member.metaCopy;

  item.append(header, meta, badges);
  return item;
}

function renderCompactSummary(slot: LobbySlotViewModel): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'slot-member-summary';

  if (slot.members.length === 0) {
    summary.textContent = 'Open team. No commanders assigned.';
    return summary;
  }

  const readyCount = slot.members.filter(
    (member) => member.readyCopy === 'Ready',
  ).length;
  summary.textContent = `${slot.members.length}/${slot.capacity} commanders joined, ${readyCount} ready.`;
  return summary;
}

export class LobbySlotListUi {
  private claimHandler: ((slotId: string) => void) | null = null;
  private botAddHandler: ((slotId: string) => void) | null = null;

  public constructor(private readonly rootEl: HTMLElement) {
    this.rootEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const claimButton =
        target.closest<HTMLButtonElement>('[data-slot-claim]');
      if (claimButton && !claimButton.disabled) {
        const slotId = claimButton.dataset.slotClaim;
        if (slotId && this.claimHandler) {
          this.claimHandler(slotId);
        }
        return;
      }

      const botButton = target.closest<HTMLButtonElement>(
        '[data-slot-add-bot]',
      );
      if (botButton && !botButton.disabled) {
        const slotId = botButton.dataset.slotAddBot;
        if (slotId && this.botAddHandler) {
          this.botAddHandler(slotId);
        }
      }
    });
  }

  public setClaimHandler(handler: (slotId: string) => void): void {
    this.claimHandler = handler;
  }

  public setBotAddHandler(handler: (slotId: string) => void): void {
    this.botAddHandler = handler;
  }

  public render(slots: readonly LobbySlotViewModel[]): void {
    const compactMode = slots.length > 0 && slots.length <= 4;
    this.rootEl.classList.toggle('slot-list--compact', compactMode);
    this.rootEl.innerHTML = '';

    if (slots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slot-item';
      empty.textContent = 'No team slots available.';
      this.rootEl.append(empty);
      return;
    }

    for (const slot of slots) {
      const item = document.createElement('div');
      item.className = 'slot-item slot-card';

      const head = document.createElement('div');
      head.className = 'slot-head';

      const teamInfo = document.createElement('div');
      teamInfo.className = 'slot-team';

      const chip = document.createElement('span');
      chip.className = 'team-chip';
      chip.style.backgroundColor = slot.color;

      const label = document.createElement('strong');
      label.textContent = slot.label;

      teamInfo.append(chip, label);

      const capacity = createBadge(
        compactMode
          ? `${slot.members.length}/${slot.capacity}`
          : `${slot.members.length}/${slot.capacity} commanders`,
        'badge--slot',
      );
      head.append(teamInfo, capacity);

      const actionRow = document.createElement('div');
      actionRow.className = 'slot-claim-row';

      const availability = document.createElement('div');
      availability.className = 'slot-open-copy';
      availability.textContent =
        slot.openSeatCount > 0
          ? compactMode
            ? `${slot.openSeatCount} open`
            : `${slot.openSeatCount} open seat${slot.openSeatCount === 1 ? '' : 's'}`
          : compactMode
            ? 'Full'
            : 'Team full';

      const claimButton = document.createElement('button');
      claimButton.type = 'button';
      claimButton.textContent = compactMode ? 'Join' : slot.claimLabel;
      claimButton.dataset.slotClaim = slot.slotId;
      claimButton.disabled = !slot.canClaim;

      actionRow.append(availability, claimButton);

      if (slot.canAddBot) {
        const addBotButton = document.createElement('button');
        addBotButton.type = 'button';
        addBotButton.textContent = 'Add Bot';
        addBotButton.dataset.slotAddBot = slot.slotId;
        actionRow.append(addBotButton);
      }

      if (compactMode) {
        const summary = renderCompactSummary(slot);
        item.append(head, actionRow, summary);
      } else {
        const memberList = document.createElement('div');
        memberList.className = 'slot-member-list';
        if (slot.members.length === 0) {
          const emptySeat = document.createElement('div');
          emptySeat.className = 'slot-meta';
          emptySeat.textContent = 'No commanders assigned yet.';
          memberList.append(emptySeat);
        } else {
          for (const member of slot.members) {
            memberList.append(renderMemberRow(member));
          }
        }
        item.append(head, memberList, actionRow);
      }

      this.rootEl.append(item);
    }
  }
}
