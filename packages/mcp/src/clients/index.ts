import { claudeCode } from "./claude-code.js";
import { claudeDesktop } from "./claude-desktop.js";
import { cursor } from "./cursor.js";
import type { Client } from "./types.js";
import { vscode } from "./vscode.js";

export const clients: Client[] = [claudeCode, cursor, vscode, claudeDesktop];
