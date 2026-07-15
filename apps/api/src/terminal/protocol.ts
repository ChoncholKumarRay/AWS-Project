export type TerminalClientMessage =
  | {
      type: "input";
      data: string;
    }
  | {
      type: "resize";
      cols: number;
      rows: number;
    };

export type TerminalServerMessage =
  | {
      type: "output";
      data: string;
    }
  | {
      type: "ready";
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "exit";
    };

export function parseTerminalClientMessage(
  raw: string
): TerminalClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    return null;
  }

  if (parsed.type === "input" && "data" in parsed && typeof parsed.data === "string") {
    return {
      type: "input",
      data: parsed.data
    };
  }

  const cols = "cols" in parsed ? parsed.cols : undefined;
  const rows = "rows" in parsed ? parsed.rows : undefined;

  if (
    parsed.type === "resize" &&
    typeof cols === "number" &&
    typeof rows === "number" &&
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > 0 &&
    rows > 0
  ) {
    return {
      type: "resize",
      cols,
      rows
    };
  }

  return null;
}

export function serializeTerminalServerMessage(message: TerminalServerMessage) {
  return JSON.stringify(message);
}
