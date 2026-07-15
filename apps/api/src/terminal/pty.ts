import { spawn } from "node-pty";

export type PtyResize = {
  cols: number;
  rows: number;
};

export type TerminalPty = {
  onData(handler: (data: string) => void): { dispose(): void };
  onExit(handler: () => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtyFactory = {
  spawnMultipassShell(instanceName: string, size?: PtyResize): TerminalPty;
};

export class NodePtyFactory implements PtyFactory {
  spawnMultipassShell(instanceName: string, size: PtyResize = { cols: 100, rows: 30 }) {
    return spawn("multipass", ["exec", instanceName, "--", "bash", "-l"], {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd: process.env.HOME ?? process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });
  }
}
