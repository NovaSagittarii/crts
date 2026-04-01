import type { RoomStatePayload } from '#rts-engine';

import type { LobbyControlsViewModel } from './lobby-controls-view-model.js';
import type { LobbyMembershipViewModel } from './lobby-membership-view-model.js';
import { LobbySlotListUi } from './lobby-slot-list-ui.js';
import {
  getLobbySlotColor,
  getLobbySlotLabel,
} from './lobby-slot-presentation.js';

interface LobbyScreenUiElements {
  statusEl: HTMLElement;
  countdownEl: HTMLElement;
  slotListEl: HTMLElement;
  spectatorListEl: HTMLElement;
  spawnMarkersEl: HTMLElement;
  readyButton: HTMLButtonElement;
  startButton: HTMLButtonElement;
}

export class LobbyScreenUi {
  private readonly slotListUi: LobbySlotListUi;

  public constructor(private readonly elements: LobbyScreenUiElements) {
    this.slotListUi = new LobbySlotListUi(elements.slotListEl);
  }

  public setClaimHandler(handler: (slotId: string) => void): void {
    this.slotListUi.setClaimHandler(handler);
  }

  public setBotAddHandler(handler: (slotId: string) => void): void {
    this.slotListUi.setBotAddHandler(handler);
  }

  public render(
    membership: LobbyMembershipViewModel,
    controls: LobbyControlsViewModel,
  ): void {
    this.elements.statusEl.textContent = controls.statusCopy;
    this.elements.countdownEl.textContent = controls.countdownCopy;
    this.elements.readyButton.textContent = controls.readyButtonLabel;
    this.elements.readyButton.disabled = controls.readyDisabled;
    this.elements.startButton.textContent = controls.startButtonLabel;
    this.elements.startButton.disabled = controls.startDisabled;
    this.slotListUi.render(membership.slots);
    this.renderSpectators(membership);
  }

  public renderSpawnMarkers(payload: RoomStatePayload): void {
    this.elements.spawnMarkersEl.innerHTML = '';

    if (payload.teams.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'spawn-item';
      empty.textContent = 'Spawn markers appear after commanders claim teams.';
      this.elements.spawnMarkersEl.append(empty);
      return;
    }

    const sortedTeams = [...payload.teams].sort((a, b) => a.id - b.id);
    for (const team of sortedTeams) {
      const item = document.createElement('div');
      item.className = 'spawn-item';

      const title = document.createElement('div');
      title.className = 'slot-team';

      const chip = document.createElement('span');
      chip.className = 'team-chip';
      chip.style.backgroundColor = getLobbySlotColor(
        `team-${team.id}`,
        team.id - 1,
      );

      const label = document.createElement('strong');
      label.textContent = getLobbySlotLabel(`team-${team.id}`);
      title.append(chip, label);

      const meta = document.createElement('div');
      meta.className = 'spawn-meta';
      meta.textContent = `base top-left: (${team.baseTopLeft.x}, ${team.baseTopLeft.y})`;

      item.append(title, meta);
      this.elements.spawnMarkersEl.append(item);
    }
  }

  public reset(): void {
    this.elements.statusEl.textContent = 'Host: none';
    this.elements.countdownEl.textContent = 'Waiting for host';
    this.elements.readyButton.textContent = 'Set Ready';
    this.elements.readyButton.disabled = true;
    this.elements.startButton.textContent = 'Host Start';
    this.elements.startButton.disabled = true;
    this.elements.slotListEl.innerHTML = '';
    this.elements.spectatorListEl.innerHTML = '';
    this.elements.spawnMarkersEl.innerHTML = '';
  }

  private renderSpectators(membership: LobbyMembershipViewModel): void {
    this.elements.spectatorListEl.innerHTML = '';

    if (membership.spectators.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'spectator-item';
      empty.textContent = 'No spectators in room.';
      this.elements.spectatorListEl.append(empty);
      return;
    }

    for (const spectator of membership.spectators) {
      const item = document.createElement('div');
      item.className = 'spectator-item';

      const title = document.createElement('div');
      title.textContent = spectator.displayName;

      const meta = document.createElement('div');
      meta.className = 'spectator-meta';
      meta.textContent = `session: ${spectator.sessionId}`;

      item.append(title, meta);
      this.elements.spectatorListEl.append(item);
    }
  }
}
