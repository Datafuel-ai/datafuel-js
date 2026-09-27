export type Ctx = { url: string; key: string };

export type Found = { path: string; key: string | undefined };

export type Client = {
  id: string;
  label: string;
  path(): string;
  detect(): Promise<boolean>;
  configured(): Promise<Found | undefined>;
  install(ctx: Ctx): Promise<string>;
  remove(): Promise<string | undefined>;
  restart: string;
};
