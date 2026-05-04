declare module "howler" {
  export class Howl {
    constructor(options: Record<string, unknown>);
    play(): number;
    pause(): this;
    stop(): this;
    seek(): number;
    seek(position: number): this;
    rate(rate: number): this;
    duration(): number;
    playing(): boolean;
    once(event: string, fn: () => void): this;
    on(event: string, fn: (...args: unknown[]) => void): this;
    unload(): void;
  }
}
