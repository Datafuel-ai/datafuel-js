import { clients } from "./clients/index.js";

export const mask = (key: string) => `df_key_••••${key.length > 12 ? key.slice(-4) : ""}`;

const width = Math.max(...clients.map((c) => c.label.length)) + 2;
export const row = (label: string, detail: string) => `${label.padEnd(width)}${detail}`;
