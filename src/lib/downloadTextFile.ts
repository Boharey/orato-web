/**
 * downloadTextFile.ts
 * --------------------
 * Small shared utility — triggers a browser download of plain text
 * content without needing a real file on a server. Used for the
 * transcript download; kept generic in case anything else ever needs
 * the same "here's some text, save it as a file" behavior.
 */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
