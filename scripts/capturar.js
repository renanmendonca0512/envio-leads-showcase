// Tira os prints da vitrine com o Edge escondido (sem extensões, perfil temporário).
// Uso: node scripts/capturar.js http://localhost:3100
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = (process.argv[2] || "http://localhost:3100").replace(/\/+$/, "");
const SAIDA = path.join(__dirname, "..", "prints");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORTA = 9333;
const SENHA = "Vitrine-demo-2026!";
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

const ROTEIRO = [
  {
    email: "marina@exemplo.com",
    telas: [["01-inicio", "inicio"], ["02-enviar", "enviar"], ["03-historico", "historico"], ["04-entradas", "entradas"], ["05-integracoes", "integracoes"]],
  },
];

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-edge-"));
  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, "--window-size=1440,900",
    "--force-device-scale-factor=1", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
  try {
    let alvos;
    for (let i = 0; i < 40 && !alvos; i++) {
      try { alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json(); } catch { await espera(250); }
    }
    const pagina = alvos.find((a) => a.type === "page");
    const ws = new WebSocket(pagina.webSocketDebuggerUrl);
    await new Promise((ok) => ws.addEventListener("open", ok));
    let id = 0;
    const pend = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const cdp = (method, params = {}) => new Promise((ok) => { const n = ++id; pend.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
    const avaliar = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

    await cdp("Page.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

    for (const etapa of ROTEIRO) {
      await cdp("Page.navigate", { url: BASE + "/?sso=nao" });
      await espera(1500);
      await avaliar(`fetch('/api/sair',{method:'POST',headers:{'X-App':'envio-leads'}}).catch(()=>0)`);
      const st = await avaliar(`fetch('/api/login',{method:'POST',headers:{'X-App':'envio-leads','Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(etapa.email)},senha:${JSON.stringify(SENHA)}})}).then(r=>r.status)`);
      if (st !== 200) throw new Error(`login ${etapa.email}: ${st}`);
      await cdp("Page.navigate", { url: `${BASE}/` }); // recarrega já com a sessão
      await espera(3000);
      const quem = await avaliar(`fetch('/api/sessao',{headers:{'X-App':'envio-leads'}}).then(r=>r.ok?r.json():null).then(j=>j&&(j.usuario?.email||j.email))`);
      if (quem !== etapa.email) throw new Error(`sessão errada: esperava ${etapa.email}, veio ${quem}`);
      for (const [arquivo, tela] of etapa.telas) {
        await avaliar(`document.querySelector('[data-aba="${tela}"]').click()`);
        await espera(4500); // carregamento + animações
        const shot = await cdp("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(SAIDA, arquivo + ".png"), Buffer.from(shot.result.data, "base64"));
        console.log("ok", arquivo);
      }
    }
    ws.close();
  } finally {
    // fecha o Edge e todos os processos filhos dele
    spawn("taskkill", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
    await espera(2000);
    try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* o Edge às vezes segura a pasta; é temporária */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
