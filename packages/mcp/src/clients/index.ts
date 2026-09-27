import { claudeCode } from "./claude-code.js";
import { claudeDesktop } from "./claude-desktop.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { gemini } from "./gemini.js";
import type { Client } from "./types.js";
import { vscode } from "./vscode.js";
import { windsurf } from "./windsurf.js";

export const clients: Client[] = [
  claudeCode,
  cursor,
  vscode,
  windsurf,
  claudeDesktop,
  codex,
  gemini,
];
