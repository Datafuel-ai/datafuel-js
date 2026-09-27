export const mask = (key: string) => `df_key_••••${key.length > 12 ? key.slice(-4) : ""}`;

export const redact = (text: string) => text.replace(/df_key_[^\s'"]*/g, mask);
