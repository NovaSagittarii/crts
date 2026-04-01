import type { RtsRoom } from '#rts-engine';

export interface ObservationResult {
  planes: Float32Array;
  scalars: Float32Array;
  shape: {
    channels: number;
    height: number;
    width: number;
    scalarCount: number;
  };
}

export class ObservationEncoder {
  constructor(
    _width: number,
    _height: number,
  ) {
    // stub
  }

  public encode(
    _room: RtsRoom,
    _teamId: number,
    _tick: number,
    _maxTicks: number,
  ): ObservationResult {
    throw new Error('Not implemented');
  }
}
