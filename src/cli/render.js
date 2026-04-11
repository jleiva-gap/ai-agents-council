const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;

function visibleLength(text) {
  return String(text ?? "").replace(ANSI_ESCAPE_RE, "").length;
}

function padRight(text, width) {
  const raw = String(text ?? "");
  const padding = Math.max(0, width - visibleLength(raw));
  return `${raw}${" ".repeat(padding)}`;
}

function pushWrappedLine(lines, line) {
  lines.push(line.trimEnd());
}

export function wrapText(text, width) {
  const maxWidth = Math.max(1, Number(width) || 1);
  const source = String(text ?? "");
  const paragraphs = source.split("\n");
  const lines = [];

  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    if (paragraphIndex > 0) {
      lines.push("");
    }

    if (!paragraph) {
      continue;
    }

    const tokens = paragraph.split(/(\u001b\[[0-9;]*m|\s+)/g).filter(Boolean);
    let line = "";
    let lineWidth = 0;

    const flush = () => {
      pushWrappedLine(lines, line);
      line = "";
      lineWidth = 0;
    };

    for (const token of tokens) {
      if (/^\u001b\[[0-9;]*m$/.test(token)) {
        line += token;
        continue;
      }

      if (/^\s+$/.test(token)) {
        if (lineWidth > 0 && !line.endsWith(" ")) {
          line += " ";
          lineWidth += 1;
        }
        continue;
      }

      let remaining = token;
      while (remaining.length > 0) {
        const available = maxWidth - lineWidth;
        if (available <= 0) {
          flush();
          continue;
        }

        if (remaining.length <= available) {
          line += remaining;
          lineWidth += remaining.length;
          remaining = "";
          continue;
        }

        if (lineWidth > 0) {
          flush();
          continue;
        }

        const chunk = remaining.slice(0, maxWidth);
        line += chunk;
        lineWidth += chunk.length;
        remaining = remaining.slice(maxWidth);
        if (remaining.length > 0) {
          flush();
        }
      }
    }

    pushWrappedLine(lines, line);
  }

  return lines;
}

export function formatPanelLines(title, rows = [], width = 92) {
  const panelWidth = Math.max(12, Number(width) || 92);
  const contentWidth = panelWidth - 4;
  const border = `+${"-".repeat(panelWidth - 2)}+`;
  const lines = [{ text: border, strong: true }];

  for (const titleLine of wrapText(title, contentWidth)) {
    lines.push({ text: `| ${padRight(titleLine, contentWidth)} |`, strong: true });
  }

  lines.push({ text: border, strong: true });

  for (const row of rows) {
    const wrappedRows = wrapText(row, contentWidth);
    if (wrappedRows.length === 0) {
      lines.push({ text: `| ${" ".repeat(contentWidth)} |`, strong: false });
      continue;
    }

    for (const wrappedRow of wrappedRows) {
      lines.push({ text: `| ${padRight(wrappedRow, contentWidth)} |`, strong: false });
    }
  }

  lines.push({ text: border, strong: true });
  return lines;
}
