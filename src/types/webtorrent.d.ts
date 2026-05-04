declare module "webtorrent" {
  import { EventEmitter } from "node:events";

  export default class WebTorrent extends EventEmitter {
    constructor(opts?: Record<string, unknown>);
    torrents: unknown[];
    add(torrentId: unknown, opts?: Record<string, unknown>, ontorrent?: (torrent: unknown) => void): unknown;
    remove(torrentId: unknown, opts?: Record<string, unknown>, cb?: (err: Error | null) => void): Promise<void>;
    destroy(cb?: (err: Error | null) => void): void;
  }
}
