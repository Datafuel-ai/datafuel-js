export type Ctx = { url: string; key: string };

export type Client = {
  id: string;
  label: string;
  path(): string;
  detect(): Promise<boolean>;
  configured(): Promise<boolean>;
  install(ctx: Ctx): Promise<string>;
  remove(): Promise<string | undefined>;
  restart: string;
};
