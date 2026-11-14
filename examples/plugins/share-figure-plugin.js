// Example integration: export the current figure and hand it to another tool.
// Replace the "download" step with a call to Zenodo, OSF, Figshare, a lab server, etc.
export default {
  id: "share-figure",
  name: "Share figure",
  description: "Copy the figure as PNG to the clipboard or download it as SVG.",
  category: "integration",
  icon: "📤",

  mount(container, host, close) {
    const info = host.getFigureInfo();
    const note = document.createElement("p");
    note.textContent = `“${info.title}” · ${info.width} × ${info.height}px · ${info.objectCount} objects`;

    const copy = document.createElement("button");
    copy.className = "button primary";
    copy.textContent = "Copy PNG to clipboard";
    copy.onclick = async () => {
      try {
        const png = await host.exportFigure("png", 2);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        host.notify("Figure copied — paste it into slides, chat or a document.");
        close();
      } catch (error) {
        host.notify(`Copy failed: ${error.message}`);
      }
    };

    const save = document.createElement("button");
    save.className = "button";
    save.style.marginLeft = "8px";
    save.textContent = "Download SVG";
    save.onclick = async () => {
      const svg = await host.exportFigure("svg");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(svg), download: `${info.title || "figure"}.svg` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };

    container.append(note, copy, save);
  },
};
