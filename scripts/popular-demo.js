// Cria dados FICTÍCIOS num Envio de Leads vazio, só para os prints da vitrine.
// Sobe uma API de CRM falsa (porta 3199) que aceita os leads com ~30 ms de atraso e recusa alguns,
// envia uma planilha de 1.400 leads inventados e recebe alguns leads pelo webhook.
// Uso: suba o Envio de Leads com PORTA=3100, PORTA_WEBHOOK=3101, TUNEL=0, PERMITIR_REDE_LOCAL=1 e PASTA_DADOS temporária:
//   node scripts/popular-demo.js http://localhost:3100
const http = require("node:http");

const BASE = (process.argv[2] || "http://localhost:3100").replace(/\/+$/, "");
const SENHA = "Vitrine-demo-2026!";
const H = { "X-App": "envio-leads" };
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- CRM falso ----------
let recebidos = 0;
const crm = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    recebidos++;
    setTimeout(() => {
      const recusa = /recusado/i.test(corpo); // alguns leads "ruins" para o histórico mostrar erros
      res.writeHead(recusa ? 422 : 201, { "Content-Type": "application/json" });
      res.end(recusa ? '{"erro":"telefone inválido no CRM"}' : `{"id":${recebidos}}`);
    }, 30);
  });
});

const PRIMEIROS = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Hugo", "Isabela", "João", "Karina", "Leandro",
  "Mariana", "Nelson", "Olívia", "Pedro", "Queila", "Rafaela", "Samuel", "Tânia", "Ulisses", "Vera", "Wagner", "Yasmin"];
const SOBRENOMES = ["Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Fonseca", "Guimarães", "Holanda", "Igarashi", "Jardim",
  "Klein", "Lacerda", "Macedo", "Nogueira", "Otero", "Pimentel", "Quintana", "Rezende", "Siqueira", "Toledo"];
const ORIGENS = ["Instagram", "Facebook", "Google Ads", "Site", "Indicação"];

function planilha(qtd) {
  const linhas = ["nome,email,celular,origem"];
  for (let i = 0; i < qtd; i++) {
    const nome = `${PRIMEIROS[i % PRIMEIROS.length]} ${SOBRENOMES[(i * 7) % SOBRENOMES.length]}`;
    const recusado = i % 97 === 13 ? " Recusado" : "";
    const email = i % 53 === 0 ? "" : `lead${i}@exemplo.com`;
    const tel = `4198${String(1000000 + i).slice(-7)}`;
    linhas.push(`${nome}${recusado},${email},${tel},${ORIGENS[i % ORIGENS.length]}`);
  }
  // alguns repetidos e um inválido (sem contato)
  linhas.push("Ana Almeida,lead0@exemplo.com,41981000000,Instagram", "Bruno Duarte,lead1@exemplo.com,41981000001,Facebook", "Sem Contato,,,Site");
  return linhas.join("\n");
}

async function api(rota, corpo, metodo, cookie) {
  const json = corpo && !(corpo instanceof FormData);
  const r = await fetch(BASE + "/api" + rota, {
    method: metodo || (corpo ? "POST" : "GET"),
    headers: { ...H, ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: json ? JSON.stringify(corpo) : corpo,
  });
  const txt = await r.text();
  if (r.status >= 400) throw new Error(`${rota} → ${r.status} ${txt}`);
  return { json: txt ? JSON.parse(txt) : null, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}

async function main() {
  await new Promise((ok) => crm.listen(3199, "127.0.0.1", ok));
  const ck = (await api("/primeiro-acesso", { nome: "Marina Duarte", email: "marina@exemplo.com", senha: SENHA })).cookie;
  const a = (rota, corpo, metodo) => api(rota, corpo, metodo, ck);

  const crmVendas = (await a("/integracoes", {
    nome: "CRM de vendas (demo)", url: "http://localhost:3199/api/leads", auth_tipo: "bearer", auth_segredo: "token-de-demonstracao",
    mapeamento: { name: "{{nome}}", email: "{{email}}", phone: "{{celular}}", source: "{{origem|Planilha}}" }, envios_simultaneos: 10, intervalo_ms: 0,
  })).json;
  await a("/integracoes", {
    nome: "Automação n8n (demo)", url: "http://localhost:3199/webhook/novo-lead",
    mapeamento: { lead: { nome: "{{nome}}", contato: "{{telefone}}" } }, intervalo_ms: 0,
  });

  // planilha grande: mostra a velocidade
  const fd = new FormData();
  fd.append("integracao_id", String(crmVendas.id));
  fd.append("arquivo", new Blob([planilha(1400)], { type: "text/csv" }), "leads-campanha-novembro.csv");
  const inicio = Date.now();
  await a("/lotes", fd);
  for (;;) {
    await espera(1000);
    const { lotes } = (await a("/lotes")).json;
    if (lotes.every((l) => !["na_fila", "enviando"].includes(l.status))) break;
  }
  console.log(`1.400 leads enviados em ${Math.round((Date.now() - inicio) / 1000)} s`);

  // planilha pequena
  const fd2 = new FormData();
  fd2.append("integracao_id", String(crmVendas.id));
  fd2.append("arquivo", new Blob([planilha(1400).split("\n").slice(0, 1).concat(
    Array.from({ length: 60 }, (_, i) => `Cliente Evento ${i + 1},evento${i}@exemplo.com,4197${String(1000000 + i).slice(-7)},Feira`)).join("\n")],
  { type: "text/csv" }), "feira-imoveis.csv");
  await a("/lotes", fd2);

  // webhook: formulário do site
  const entrada = (await a("/entradas", { nome: "Formulário do site", integracao_id: crmVendas.id })).json;
  const caminho = new URL(entrada.url_publica || entrada.url_local || entrada.url).pathname;
  for (let i = 0; i < 18; i++) {
    await fetch("http://localhost:3101" + caminho, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: `${PRIMEIROS[(i * 5) % 24]} ${SOBRENOMES[(i * 3) % 20]}`, email: `site${i}@exemplo.com`, telefone: `(41) 99${String(7000000 + i * 131).slice(-7)}`, origem: "Site" }),
    });
    await espera(120);
  }
  await a("/entradas", { nome: "Landing page Black Friday", integracao_id: crmVendas.id });
  await espera(3000);
  console.log("Pronto. Login: marina@exemplo.com / senha", SENHA);
  crm.close();
}

main().catch((e) => { console.error(e.message); crm.close(); process.exit(1); });
