import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Lightweight pipe-table renderer
// - Old iOS Safari can crash/blank-screen on remark-gfm with some table-heavy/inline-table markdown.
// - This component keeps table rendering by parsing pipe tables and rendering <table> directly.

function normalizeInlinePipeTables(md) {
    if (!md || typeof md !== "string") return md;
    return md
        // LLMs often concatenate rows into one line: "| A | B | |---|---| | 1 | 2 |"
        // Best-effort: treat `| |` as row boundary.
        .replace(/\|\s*\|/g, "|\n|")
        .trim();
}

function isPipeTableSeparatorLine(line) {
    const s = (line || "").trim();
    if (!s.includes("|")) return false;
    // e.g. "|---|---|" or "|:---|---:|"
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(s);
}

function parsePipeRow(line) {
    const raw = (line || "").trim();
    const trimmed = raw.replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((c) => c.trim());
}

function splitMarkdownIntoBlocks(md) {
    const text = typeof md === "string" ? md : "";
    const lines = text.split(/\r?\n/);
    const blocks = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i] || "";
        const next = lines[i + 1] || "";

        // Table block: header line + separator line
        if (line.includes("|") && isPipeTableSeparatorLine(next)) {
            const tableLines = [line, next];
            i += 2;
            while (i < lines.length) {
                const l = lines[i] || "";
                if (!l.trim()) break;
                if (!l.includes("|")) break;
                if (isPipeTableSeparatorLine(l)) break;
                tableLines.push(l);
                i += 1;
            }
            blocks.push({ type: "table", lines: tableLines });
            while (i < lines.length && !(lines[i] || "").trim()) i += 1;
            continue;
        }

        // Text block
        const textLines = [line];
        i += 1;
        while (i < lines.length) {
            const l = lines[i] || "";
            const n = lines[i + 1] || "";
            if (l.includes("|") && isPipeTableSeparatorLine(n)) break;
            textLines.push(l);
            i += 1;
        }
        blocks.push({ type: "text", text: textLines.join("\n") });
    }

    return blocks.filter((b) => {
        if (b.type === "table") return Array.isArray(b.lines) && b.lines.length >= 2;
        return (b.text || "").trim().length > 0;
    });
}

function parsePipeTableLines(tableLines) {
    if (!Array.isArray(tableLines) || tableLines.length < 2) return null;
    const header = parsePipeRow(tableLines[0]);
    const separator = tableLines[1];
    if (!isPipeTableSeparatorLine(separator)) return null;
    const rows = tableLines.slice(2).map(parsePipeRow);

    const colCount = Math.max(1, header.length);
    const norm = (r) => {
        const rr = Array.isArray(r) ? r.slice(0, colCount) : [];
        while (rr.length < colCount) rr.push("");
        return rr;
    };

    return { header: norm(header), rows: rows.map(norm) };
}

function MarkdownTable({ table }) {
    if (!table) return null;
    return (
        <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse text-sm">
                <thead>
                    <tr>
                        {table.header.map((h, idx) => (
                            <th
                                key={`h-${idx}`}
                                className="border border-white/10 px-2 py-1 text-left font-semibold text-gray-100"
                            >
                                {h || " "}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, rIdx) => (
                        <tr key={`r-${rIdx}`}>
                            {row.map((cell, cIdx) => (
                                <td key={`c-${rIdx}-${cIdx}`} className="border border-white/10 px-2 py-1 text-gray-100">
                                    {cell || " "}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function renderMarkdownWithCustomTables(rawMd, keyPrefix = "md") {
    const md = normalizeInlinePipeTables(rawMd || "");
    const blocks = splitMarkdownIntoBlocks(md);
    return blocks.map((b, idx) => {
        if (b.type === "table") {
            const parsed = parsePipeTableLines(b.lines);
            if (parsed) return <MarkdownTable key={`${keyPrefix}-t-${idx}`} table={parsed} />;
            return (
                <ReactMarkdown key={`${keyPrefix}-tbad-${idx}`}>
                    {b.lines.join("\n")}
                </ReactMarkdown>
            );
        }
        return (
            <ReactMarkdown key={`${keyPrefix}-p-${idx}`}>
                {b.text}
            </ReactMarkdown>
        );
    });
}

export default function MarkdownWithTables({ markdown, isOldSafariIOS = false, keyPrefix = "md" }) {
    if (isOldSafariIOS) return <>{renderMarkdownWithCustomTables(markdown, keyPrefix)}</>;

    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {typeof markdown === "string" ? markdown : ""}
        </ReactMarkdown>
    );
}


