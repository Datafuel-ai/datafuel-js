export type Ctx = { url: string; key: string };

export type Found = { path: string; key: string | undefined };

export type Client = {
  id: string;
  label: string;
  project: boolean;
  keyOnDisk: boolean;
  path(dir?: string): string;
  detect(): Promise<boolean>;
  configured(dir?: string): Promise<Found[]>;
  install(ctx: Ctx, dir?: string): Promise<string>;
  remove(dir?: string): Promise<string | undefined>;
  restart: string;
};
