// Minimal Di-Render external plugin. Host this file over HTTPS and add its URL in
// Plugins → Manage. See docs/PLUGINS.md for the full host API.
export default {
  id: "hello",
  name: "Hello plugin",
  description: "Inserts a labelled circle — a starting point for your own plugin.",
  category: "tool",
  icon: "👋",

  mount(container, host, close) {
    const label = document.createElement("input");
    label.value = "Sample A";
    label.style.cssText = "padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;margin-right:8px";
    const button = document.createElement("button");
    button.className = "button primary";
    button.textContent = "Insert";
    button.onclick = async () => {
      const text = label.value.replace(/[<&>"]/g, "");
      try {
        await host.insertSvg(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
             <circle cx="60" cy="60" r="54" fill="#dbe7ff" stroke="#2f6fec" stroke-width="4"/>
             <text x="60" y="66" text-anchor="middle" font-family="Arial" font-size="16" fill="#1b2c4a">${text}</text>
           </svg>`,
          { title: `Label ${text}`, provider: "Hello plugin",
            license: { id: "CC0-1.0", name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", attributionRequired: false } },
        );
        close();
      } catch (error) {
        host.notify(error.message);
      }
    };
    container.append(label, button);
    return () => container.replaceChildren();
  },
};
