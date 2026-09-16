export const HOURS_PER_MONTH = 720; // 30 days x 24 h
export const SLIDING_WINDOW_HOURS = 168; // one week, RF-5
export const MAD_THRESHOLD = 3; // residual > median + 3 * MAD
export const TOP_K_TRAFOS = 200; // RF-6 ranking size
export const METER_ID_LENGTH = 12; // 12 hex chars

export const BYTES_PER_RECORD = 4 + 2 + 2 + 1 + 8; // 17, padded to 24 by store layout

export const FLAG_ESTIMATED = 1;
export const FLAG_GAP = 2;
export const FLAG_REVERSE = 4;

export const DEFAULT_BLOCK_BYTES = 8 * 1024 * 1024;

export const HASH_MAX_LOAD = 0.7;
