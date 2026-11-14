// Tira os prints da vitrine com o Edge escondido (sem extensões, perfil temporário).
// Uso: node scripts/capturar.js http://localhost:3100
//
// Cada print só é tirado quando a tela terminou de carregar. Rode com o Ascenda da demo aberto ao lado
// (porta 4100) para o botão "Voltar para o Ascenda" aparecer no menu.
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

// Tela Enviar: escolhe o CRM da demo e solta uma planilha fictícia, para aparecer a conferência
const PREPARAR_ENVIO = `(async () => {
  const destino = [...document.querySelectorAll("#escolha-integracao input, #escolha-integracao button, #escolha-integracao label")]
    .find((e) => /CRM de vendas/.test(e.closest("label, button, .escolha")?.innerText || e.innerText || ""));
  (destino?.closest("label") || destino)?.click();
  const linhas = ["nome;telefone;email;origem"];
  const nomes = ["Helena Prado", "Caio Martins", "Lívia Rocha", "Otávio Nunes", "Sofia Campos", "Rafael Teles", "Bianca Leal", "Gustavo Pires"];
  for (let i = 0; i < 240; i++) linhas.push(nomes[i % 8] + ";" + (i === 7 || i === 91 ? "123" : "4199988" + String(1000 + i).slice(-4)) + ";cliente" + i + "@exemplo.com;" + ["instagram", "fecbook", "site", "indicacao"][i % 4]);
  const dt = new DataTransfer();
  dt.items.add(new File([linhas.join("\\r\\n")], "leads-feira-novembro.csv", { type: "text/csv" }));
  const entrada = document.querySelector("#envio-arquivo");
  entrada.files = dt.files;
  entrada.dispatchEvent(new Event("change"));
  for (let i = 0; i < 40 && document.querySelector("#previa").classList.contains("oculto"); i++) await new Promise((ok) => setTimeout(ok, 250));
  return !document.querySelector("#previa").classList.contains("oculto");
})()`;

const ROTEIRO = [
  {
    email: "marina@exemplo.com",
    telas: [["01-inicio", "inicio"], ["02-enviar", "enviar", PREPARAR_ENVIO], ["03-historico", "historico"], ["04-entradas", "entradas"], ["05-integracoes", "integracoes"]],
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
      for (let i = 0; i < 60 && !(await avaliar(`!document.querySelector(".layout").classList.contains("oculto") && document.querySelector("#carregando")?.classList.contains("oculto") !== false`)); i++) await espera(250);
      await espera(1000);
      const quem = await avaliar(`fetch('/api/sessao',{headers:{'X-App':'envio-leads'}}).then(r=>r.ok?r.json():null).then(j=>j&&(j.usuario?.email||j.email))`);
      if (quem !== etapa.email) throw new Error(`sessão errada: esperava ${etapa.email}, veio ${quem}`);
      for (const [arquivo, tela, preparar] of etapa.telas) {
        await avaliar(`document.querySelector('[data-aba="${tela}"]').click()`);
        // espera a aba aparecer e terminar de carregar
        let pronta = false;
        for (let i = 0; i < 60 && !pronta; i++) {
          pronta = await avaliar(`(() => { const a = document.querySelector('#aba-${tela}, [data-painel="${tela}"], section.aba-conteudo:not(.oculto)'); return !!a && !a.classList.contains("oculto") && a.innerText.trim().length > 20 && !document.querySelector(".carregando:not(.oculto)"); })()`);
          if (!pronta) await espera(250);
        }
        if (!pronta) throw new Error(`a aba ${tela} não carregou`);
        if (preparar && !(await avaliar(preparar))) throw new Error(`não consegui preparar a aba ${tela}`);
        await espera(1500); // números e animações
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
