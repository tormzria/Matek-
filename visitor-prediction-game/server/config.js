export const HEARTBEAT_INTERVAL_MS = 10_000;
export const ACTIVE_WINDOW_MS = 30_000;
export const SESSION_SWEEP_MS = 5_000;
export const SNAPSHOT_INTERVAL_MS = 5_000;
export const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const TICK_BROADCAST_MS = 1_000;
export const PERSIST_INTERVAL_MS = 10_000;

export const MIN_HORIZON_SEC = 15;
export const MAX_HORIZON_SEC = 24 * 60 * 60;
export const MIN_INTERVAL_WIDTH = 1;

export const STARTING_CREDITS = 1000;
export const MIN_STAKE = 1;
export const MAX_STAKE = 500;

export const HOUSE_EDGE = 0.05;
export const MIN_MULTIPLIER = 1.01;
export const MAX_MULTIPLIER = 50;
export const MIN_PROBABILITY = 1 / (MAX_MULTIPLIER * (1 - HOUSE_EDGE) + 1);

export const REFERENCE_HORIZON_SEC = 60;
export const DEFAULT_RELATIVE_VOLATILITY = 0.15;
