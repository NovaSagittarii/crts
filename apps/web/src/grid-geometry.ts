export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeyedGridRect extends GridRect {
  key: string;
}

export interface KeyedBuildZoneRect extends KeyedGridRect {
  buildRadius: number;
}
