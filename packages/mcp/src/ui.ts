import { clients } from "./clients/index.js";

const width = Math.max(...clients.map((c) => c.label.length)) + 2;
export const row = (label: string, detail: string) => `${label.padEnd(width)}${detail}`;
