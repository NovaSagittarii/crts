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

export class LobbySlotListUi {
  private claimHandler: ((slotId: string) => void) | null = null;

  public constructor(private readonly rootEl: HTMLElement) {
    this.rootEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest<HTMLButtonElement>('[data-slot-claim]');
      if (!button || button.disabled) {
        return;
      }

      const slotId = button.dataset.slotClaim;
      if (!slotId || !this.claimHandler) {
        return;
      }

      this.claimHandler(slotId);
    });
  }

  public setClaimHandler(handler: (slotId: string) => void): void {
    this.claimHandler = handler;
  }

  public render(slots: readonly LobbySlotViewModel[]): void {
    this.rootEl.classList.toggle(
      'slot-list--compact',
      slots.length > 0 && slots.length <= 4,
    );
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
        `${slot.members.length}/${slot.capacity} commanders`,
        'badge--slot',
      );
      head.append(teamInfo, capacity);

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

      const actionRow = document.createElement('div');
      actionRow.className = 'slot-claim-row';

      const availability = document.createElement('div');
      availability.className = 'slot-open-copy';
      availability.textContent =
        slot.openSeatCount > 0
          ? `${slot.openSeatCount} open seat${slot.openSeatCount === 1 ? '' : 's'}`
          : 'Team full';

      const claimButton = document.createElement('button');
      claimButton.type = 'button';
      claimButton.textContent = slot.claimLabel;
      claimButton.dataset.slotClaim = slot.slotId;
      claimButton.disabled = !slot.canClaim;

      actionRow.append(availability, claimButton);
      item.append(head, memberList, actionRow);
      this.rootEl.append(item);
    }
  }
}
