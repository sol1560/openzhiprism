/** Runs in the isolated content world; never renders chat HTML. */
export function showToast(title: string, detail: string, appUrl: string, isError: boolean) {
  document.getElementById("zhiprism-capture-status")?.remove();
  const host = document.createElement("div"); host.id = "zhiprism-capture-status";
  host.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:calc(100vw - 32px)";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = ':host{all:initial}.notice{font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#243247;background:#fffdf8;border:1px solid #d9e1ea;border-radius:16px;box-shadow:0 8px 32px #15253f24;padding:18px 20px;width:304px;max-width:calc(100vw - 76px)}header{display:flex;gap:12px;align-items:center}strong{font-size:15px;flex:1}small{color:#52637a}p{margin:8px 0 12px;color:#52637a}a,button{font:inherit;letter-spacing:.02em}a{color:#2365a9;text-decoration:none}button{color:#52637a;border:0;background:transparent;cursor:pointer;padding:4px 8px}button:focus-visible,a:focus-visible{outline:2px solid #2878d0;outline-offset:3px}.error{border-color:#d88d7c}';
  const section = document.createElement("section"); section.className = "notice" + (isError ? " error" : ""); section.setAttribute("role", "status");
  const header = document.createElement("header"), brand = document.createElement("small"), heading = document.createElement("strong");
  brand.textContent = "知棱"; heading.textContent = title;
  const close = document.createElement("button"); close.textContent = "×"; close.setAttribute("aria-label", "关闭提示"); close.onclick = () => host.remove();
  header.append(brand, heading, close);
  const description = document.createElement("p"); description.textContent = detail;
  const link = document.createElement("a"); link.textContent = isError ? "查看连接与安装帮助 ↗" : "查看知棱 ↗";
  link.href = appUrl + (isError ? "/extension" : "/profile"); link.target = "_blank"; link.rel = "noopener noreferrer";
  section.append(header, description, link); shadow.append(style, section); document.documentElement.append(host);
}
