// ==============================================================
// CONFIGURAÇÕES GERAIS E INICIALIZAÇÃO
// ==============================================================

const MAPBOX_KEY = "pk.eyJ1Ijoid2VsZXJzb25oZXJpbmdlciIsImEiOiJjbWl2eWVtbTIxOHpjM2tuYmFzaWxwOXM0In0.o4wyQuEQAAPiOkHLIGzz-g"; 

const firebaseConfig = {
  apiKey: "AIzaSyARALEOLxIb7TlsSRqI0fdNfY8D-SgcYbY",
  authDomain: "roteirizadorfotus.firebaseapp.com",
  projectId: "roteirizadorfotus",
  storageBucket: "roteirizadorfotus.firebasestorage.app",
  messagingSenderId: "597979098930",
  appId: "1:597979098930:web:b8fb54a0ffc160e39a312b",
  measurementId: "G-Z3P42WF5HD"
};

// Inicializa Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth(); // Adicionado Auth

// Inicializa Mapbox
mapboxgl.accessToken = MAPBOX_KEY;
const map = new mapboxgl.Map({ container: 'map', style: 'mapbox://styles/mapbox/streets-v12', center: [-40.3842, -20.3708], zoom: 5 });
let kpiChartInstance = null;

// ==============================================================
// VARIÁVEIS GLOBAIS E CONSTANTES
// ==============================================================

// IMPORTANTE: currentUser agora será preenchido pelo Firebase Auth
let currentUser = { nome: "Carregando...", cd: "CD Viana - ES" }; 
let historicoCache = []; 
let pedidosPorCD = {}; 
let currentCD = "CD Viana - ES";
let rotasGeradas = [];
let markers = [];
let risksCache = [];
let transportadoresCache = [];
let currentRouteIndex = -1;
let textoCotacaoAtual = "";
let ofertasCache = [];

const LIMIT_PESO = 27000;
const CUSTO_TRUCK = 6.50;
const CUSTO_CARRETA = 9.00;
const PCT_FRACIONADO = 0.04; 

const CDS_FOTUS = [
    { key: "CD Viana - ES", nome: "CD Viana - ES", coords: [-40.409, -20.366] },
    { key: "CD Itupeva - SP", nome: "CD Itupeva - SP", coords: [-47.054, -23.153] },
    { key: "CD Goiânia - GO", nome: "CD Goiânia - GO", coords: [-49.264, -16.686] },
    { key: "CD Guaramirim - SC", nome: "CD Guaramirim - SC", coords: [-49.033, -26.474] },
    { key: "CD Ananindeua - PA", nome: "CD Ananindeua - PA", coords: [-48.375, -1.366] },
    { key: "CD Cabo - PE", nome: "CD Cabo - PE", coords: [-35.035, -8.286] },
    { key: "CD Feira - BA", nome: "CD Feira - BA", coords: [-38.966, -12.266] },
];

CDS_FOTUS.forEach(cd => pedidosPorCD[cd.key] = []);

// ==============================================================
// CICLO DE VIDA E LOGIN (ATUALIZADO PARA FIREBASE AUTH)
// ==============================================================

map.on('load', () => {
    map.resize();
    initDropdown();
    // checkLogin(); -> REMOVIDO (Era o login antigo de modal)
    verificarAutenticacao(); // -> NOVO (Verifica o Firebase)
    carregarRiscos();
    carregarTransportadores();
    carregarHistorico();
    carregarDashboard();
});

// NOVA FUNÇÃO DE LOGIN SEGURO
function verificarAutenticacao() {
    auth.onAuthStateChanged((user) => {
        if (user) {
            // Usuário está logado via Firebase!
            console.log("Usuário logado:", user.email);
            
            // Recupera o CD escolhido na tela anterior (index da raiz)
            const cdSalvo = localStorage.getItem('fotus_user_cd') || "CD Viana - ES";
            
            // Define o objeto global que o resto do sistema usa
            currentUser = {
                nome: user.email.split('@')[0].toUpperCase(), // Ex: joao.silva -> JOAO.SILVA
                cd: cdSalvo,
                email: user.email,
                uid: user.uid
            };

            // Atualiza a tela (Sidebar)
            document.getElementById('displayUser').innerText = currentUser.nome;
            document.getElementById('displayFilial').innerText = currentUser.cd;
            
            // Ajusta o Select para o CD do usuário
            const sel = document.getElementById('selectOrigem');
            sel.value = currentUser.cd;
            currentCD = currentUser.cd;

            // Voa para o CD
            const cdObj = CDS_FOTUS.find(c => c.nome === currentCD);
            if(cdObj) map.flyTo({center: cdObj.coords, zoom: 8});

        } else {
            // Não está logado -> Manda para a tela de login na raiz
            console.warn("Sem sessão. Redirecionando...");
            window.location.href = "../"; 
        }
    });
}

window.logout = function() {
    if(confirm("Deseja realmente sair?")) {
        auth.signOut().then(() => {
            window.location.href = "../"; // Volta para o login
        });
    }
};

// ... O RESTANTE DO CÓDIGO PERMANECE IDÊNTICO PARA GARANTIR FUNCIONALIDADE ...

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => { p.classList.remove('show', 'active'); p.style.display='none'; });
            e.target.classList.add('active');
            const target = document.getElementById(e.target.getAttribute('href').substring(1));
            if(target) { target.classList.add('show', 'active'); target.style.display='block'; }
            if(e.target.getAttribute('href')==='#tab-history') carregarHistorico();
            if(e.target.getAttribute('href')==='#tab-dash') carregarDashboard();
            if(e.target.getAttribute('href')==='#tab-quotes') carregarListaCotacoes();
        });
    });
});

// ==============================================================
// GESTÃO DE COTAÇÕES (MÓDULO)
// ==============================================================

window.carregarListaCotacoes = function() {
    const sel = document.getElementById('selOperacaoCotacao');
    sel.innerHTML = "<option value=''>Carregando...</option>";
    
    // Busca do histórico para preencher o select
    db.collection("historico").orderBy("data_criacao", "desc").limit(30).get().then(q => {
        sel.innerHTML = "<option value=''>-- Selecione uma Rota para Cotar --</option>";
        q.forEach(doc => {
            const d = doc.data();
            const idOp = d.id_operacao || "S/ID";
            const opt = document.createElement('option');
            opt.value = idOp; 
            opt.innerText = `${idOp} - ${d.nome_rota} (${new Date(d.data_criacao).toLocaleDateString()})`;
            opt.dataset.targetPrice = d.valor_frete || 0; 
            opt.dataset.nome = d.nome_rota;
            sel.appendChild(opt);
        });
    });
};

window.carregarOfertasDaOperacao = function() {
    const sel = document.getElementById('selOperacaoCotacao');
    const idOp = sel.value;
    
    if(!idOp) {
        document.getElementById('painelCotacao').style.display = 'none';
        document.getElementById('msgSelectRoute').style.display = 'block';
        return;
    }

    document.getElementById('painelCotacao').style.display = 'block';
    document.getElementById('msgSelectRoute').style.display = 'none';
    
    const targetPrice = parseFloat(sel.options[sel.selectedIndex].dataset.targetPrice) || 0;
    document.getElementById('quoteTarget').innerText = targetPrice.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    
    const divLista = document.getElementById('listaOfertas');
    divLista.innerHTML = "<div class='text-center py-3 text-muted'><i class='fas fa-circle-notch fa-spin'></i> Buscando lances...</div>";
    
    db.collection("cotacoes")
        .where("id_operacao", "==", idOp)
        .onSnapshot(snapshot => {
            ofertasCache = [];
            divLista.innerHTML = "";
            let bestPrice = Infinity;
            
            if (snapshot.empty) {
                divLista.innerHTML = "<div class='text-center text-muted mt-3 py-4 border border-dashed rounded bg-light small'>Nenhuma oferta registrada via link ainda.</div>";
                document.getElementById('quoteBest').innerText = "R$ 0,00";
                return;
            }

            let ofertasTemp = [];
            snapshot.forEach(doc => {
                ofertasTemp.push({id: doc.id, ...doc.data()});
            });

            ofertasTemp.sort((a, b) => a.valor_oferta - b.valor_oferta);

            ofertasTemp.forEach(d => {
                ofertasCache.push(d);
                if (d.valor_oferta < bestPrice) bestPrice = d.valor_oferta;
                
                const isBest = (d.valor_oferta === bestPrice);
                const classBest = isBest ? "border-success bg-success-subtle" : "bg-white";
                const iconBest = isBest ? '<i class="fas fa-trophy text-success"></i>' : '<i class="far fa-user-circle text-secondary"></i>';
                
                let dataHora = "-";
                if(d.timestamp && d.timestamp.toDate) {
                    dataHora = d.timestamp.toDate().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour: '2-digit', minute:'2-digit' });
                }

                divLista.innerHTML += `
                <div class="card mb-2 shadow-sm border ${isBest ? 'border-success' : 'border-light'}">
                    <div class="card-body p-2 d-flex justify-content-between align-items-center ${classBest}">
                        <div style="flex: 1;">
                            <div class="fw-bold text-dark d-flex align-items-center">
                                ${iconBest} <span class="ms-2 text-truncate" style="max-width: 180px;">${d.motorista}</span> 
                                ${d.registrado_por === "Portal Web" ? '<span class="badge bg-info text-dark ms-2" style="font-size:0.6em">WEB</span>' : ''}
                            </div>
                            <div class="small text-muted text-uppercase fw-bold" style="font-size:0.7rem; letter-spacing:0.5px;">
                                ${d.empresa || 'Particular'} • ${d.modalidade || 'N/A'}
                            </div>
                            <div class="small text-muted mt-1 fst-italic">
                                <i class="far fa-comment-dots"></i> ${d.obs || 'Sem obs'}
                            </div>
                        </div>
                        <div class="text-end ps-2 border-start">
                            <div class="h5 fw-bold ${isBest ? 'text-success' : 'text-dark'} mb-0">
                                R$ ${d.valor_oferta.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                            </div>
                            <div class="small text-muted mb-1" style="font-size:0.7rem">Prazo: ${d.prazo}</div>
                            <div class="small text-muted" style="font-size:0.65rem">${dataHora}</div>
                            <i class="fas fa-trash text-danger cursor-pointer mt-1" onclick="window.excluirOferta('${d.id}')" title="Excluir Lance"></i>
                        </div>
                    </div>
                </div>`;
            });
            
            if(bestPrice !== Infinity) {
                document.getElementById('quoteBest').innerText = bestPrice.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            }
        }, error => {
            console.error("Erro Firebase:", error);
            divLista.innerHTML = `<div class="alert alert-danger small">Erro ao carregar: ${error.message}</div>`;
        });
};

window.salvarOferta = function() {
    const idOp = document.getElementById('selOperacaoCotacao').value;
    if(!idOp) return alert("Selecione uma operação primeiro.");
    
    const mot = document.getElementById('quoteMotorista').value;
    const val = parseFloat(document.getElementById('quoteValor').value);
    const prz = document.getElementById('quotePrazo').value;
    const obs = document.getElementById('quoteObs').value;
    
    if(!mot || !val) return alert("Preencha Motorista e Valor.");
    
    db.collection("cotacoes").add({
        id_operacao: idOp,
        motorista: mot,
        valor_oferta: val,
        prazo: prz,
        obs: obs,
        registrado_por: currentUser.nome,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('quoteMotorista').value = "";
        document.getElementById('quoteValor').value = "";
        document.getElementById('quotePrazo').value = "";
        document.getElementById('quoteObs').value = "";
    });
};

window.excluirOferta = function(docId) {
    if(confirm("Excluir oferta?")) {
        db.collection("cotacoes").doc(docId).delete();
    }
};

// ==============================================================
// GESTÃO DE INPUTS E TELA PRINCIPAL
// ==============================================================

function initDropdown() {
    const sel = document.getElementById('selectOrigem');
    CDS_FOTUS.forEach(cd => {
        const opt = document.createElement('option'); opt.value = cd.nome; opt.innerText = cd.nome; sel.appendChild(opt); // USANDO O NOME COMO VALUE PRA BATER COM PEDIDOSPORCD
        const el = document.createElement('div'); el.innerHTML = `<i class="fas fa-industry" style="font-size:24px; color:#f97316; text-shadow: 2px 2px 2px black;"></i>`;
        new mapboxgl.Marker(el).setLngLat(cd.coords).setPopup(new mapboxgl.Popup().setHTML(`<b>${cd.nome}</b>`)).addTo(map);
    });
    sel.addEventListener('change', () => {
        currentCD = sel.value; voltarInput(); atualizarListaPedidos();
        const cd = CDS_FOTUS.find(c => c.nome === currentCD);
        if(cd) map.flyTo({center: cd.coords, zoom: 8});
    });
}

function addPedidoManual() {
    const end = document.getElementById('inEnd').value; 
    if(!end) return alert("Endereço obrigatório!");
    
    const p = { 
        ID: "MANUAL", 
        ENDERECO: end, 
        PESO: parseFloat(document.getElementById('inPeso').value)||0, 
        VALOR: parseFloat(document.getElementById('inValor').value)||0, 
        CUBAGEM: parseFloat(document.getElementById('inVol').value)||0, 
        DESCARGA: "Sem Auxílio" 
    };
    if(!pedidosPorCD[currentCD]) pedidosPorCD[currentCD] = []; // Garante array
    pedidosPorCD[currentCD].push(p); 
    document.getElementById('inEnd').value = ""; 
    atualizarListaPedidos();
}

function removerPedido(idx) { 
    pedidosPorCD[currentCD].splice(idx, 1); 
    atualizarListaPedidos(); 
}

function atualizarListaPedidos() {
    const lista = document.getElementById('listaPedidos'); lista.innerHTML = ""; 
    let totalPeso = 0; 
    let totalValor = 0;
    
    const peds = pedidosPorCD[currentCD] || [];

    peds.forEach((p, i) => {
        totalPeso += p.PESO; 
        totalValor += p.VALOR;
        lista.innerHTML += `
        <div class="order-item">
            <div class="text-truncate" style="max-width:200px;">
                <strong>#${p.ID}</strong> ${p.ENDERECO}
            </div>
            <div>
                <span class="badge bg-light text-dark border me-1">R$ ${p.VALOR.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</span>
                <span class="badge bg-secondary me-2">${p.PESO}kg</span>
                <i class="fas fa-trash-alt btn-del" onclick="removerPedido(${i})"></i>
            </div>
        </div>`;
    });
    
    document.getElementById('lblQtd').innerText = peds.length;
    document.getElementById('lblPeso').innerText = totalPeso.toLocaleString('pt-BR') + " kg";
    document.getElementById('lblValor').innerText = totalValor.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    
    const v = totalPeso <= 12000 ? "Truck" : (totalPeso <= 27000 ? "Carreta" : "Excedente");
    const cor = totalPeso > 27000 ? "bg-danger" : "bg-warning text-dark";
    const lbl = document.getElementById('lblVeiculo'); 
    lbl.innerText = v; lbl.className = `badge ${cor}`;
}

function handleFileUpload(input) {
    const file = input.files[0]; if (!file) return;
    showLoading(true, "Lendo Pedidos...");
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        let headerRowIndex = rows.findIndex(row => row && row.some(cell => cell && (cell.toString().toUpperCase().includes('NRO') || cell.toString().toUpperCase().includes('PEDIDO') || cell.toString().toUpperCase().includes('CIDADE') || cell.toString().toUpperCase().includes('PESO'))));
        if (headerRowIndex === -1) headerRowIndex = 0;
        const json = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" });
        let count = 0;
        const cleanNum = (val) => { if (typeof val === 'number') return val; if (!val) return 0; let s = val.toString().replace("R$", "").replace("kg", "").trim(); if (s.includes(",") && !s.includes(".")) s = s.replace(/\./g, "").replace(",", "."); else if (s.includes(",") && s.includes(".")) s = s.replace(",", "."); return parseFloat(s) || 0; };
        const getVal = (row, keys) => { const rowKeys = Object.keys(row); for (let k of keys) { const found = rowKeys.find(rk => rk.toUpperCase().trim() === k.toUpperCase().trim() || rk.toUpperCase().includes(k.toUpperCase())); if(found) return row[found]; } return ""; };
        
        if(!pedidosPorCD[currentCD]) pedidosPorCD[currentCD] = [];

        json.forEach(row => {
            const cidade = getVal(row, ['Cidade Destino', 'CIDADE', 'City']); 
            const uf = getVal(row, ['UF Destino', 'UF', 'State']); 
            let end = getVal(row, ['ENDERECO', 'Endereço', 'Logradouro']); 
            if (!end && cidade && uf) end = `${cidade} - ${uf}`;
            
            if(end || (cidade && uf)) {
                pedidosPorCD[currentCD].push({ 
                    ID: getVal(row, ['Nro. Fotus', 'NRO FOTUS', 'PEDIDO', 'Nro']) || "IMP", 
                    ENDERECO: end, 
                    PESO: cleanNum(getVal(row, ['Peso Bruto', 'PESO', 'Peso'])), 
                    VALOR: cleanNum(getVal(row, ['Valor Nota', 'VALOR', 'Valor'])), 
                    CUBAGEM: cleanNum(getVal(row, ['Volume', 'CUBAGEM'])), 
                    DESCARGA: getVal(row, ['Auxílio Descarga', 'DESCARGA']) || "Sem Auxílio", 
                    UF: uf ? uf.toUpperCase().trim() : "" 
                });
                count++;
            }
        });
        showLoading(false); 
        if (count === 0) alert("Nenhum pedido importado. Verifique os nomes das colunas."); 
        else { atualizarListaPedidos(); alert(`${count} pedidos importados!`); }
    };
    reader.readAsArrayBuffer(file);
}

// ==============================================================
// MOTOR DE ROTEIRIZAÇÃO
// ==============================================================

async function processarRota() {
    const pedidos = pedidosPorCD[currentCD];
    if(!pedidos || pedidos.length === 0) return alert("Adicione pedidos!");
    
    showLoading(true, "Geocodificando...");
    
    for (let p of pedidos) {
        if (!p.lat) {
            try {
                const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(p.ENDERECO + ", Brasil")}.json?access_token=${MAPBOX_KEY}&limit=1`);
                const data = await res.json();
                if(data.features?.length) {
                    p.lon = data.features[0].center[0];
                    p.lat = data.features[0].center[1];
                    if(!p.UF) {
                        const ctx = data.features[0].context;
                        if(ctx) { const reg = ctx.find(c=>c.id.includes('region')); if(reg) p.UF = reg.short_code.replace('BR-', ''); }
                    }
                }
            } catch(e) {}
        }
    }
    
    const validos = pedidos.filter(p => p.lat);
    if(validos.length === 0) { showLoading(false); return alert("Sem endereços válidos!"); }

    rotasGeradas = [];

    // 1. GERA A ROTA MACRO (SEM LIMITES)
    if (validos.length > 0) {
        const rotaMacro = criarRotasEngine(validos, "VISÃO MACRO (TODOS)", true);
        rotasGeradas.push(...rotaMacro);
    }

    // 2. GERA ROTAS POR ESTADO (UF)
    const ufsUnicas = [...new Set(validos.map(p => p.UF))].filter(u => u);
    
    if (ufsUnicas.length > 0) {
        ufsUnicas.forEach(uf => {
            const pedidosUF = validos.filter(p => p.UF === uf);
            const rotasUF = criarRotasEngine(pedidosUF, `ROTA ${uf}`, false); 
            rotasGeradas.push(...rotasUF);
        });
    } else {
        const rotasMistas = criarRotasEngine(validos, "ROTA MISTA", false);
        rotasGeradas.push(...rotasMistas);
    }

    showLoading(false);
    mostrarResultados();
}

function criarRotasEngine(listaPedidos, prefixoNome, ignoreLimit) {
    const rotas = [];
    const cd = CDS_FOTUS.find(c => c.nome === currentCD); // Alterado para buscar pelo NOME
    let pendentes = [...listaPedidos];
    let pontoAtual = { lat: cd.coords[1], lon: cd.coords[0] };
    let rotaAtual = [];
    let pesoAtual = 0;
    let valorAtual = 0;

    if (ignoreLimit) {
        fecharRota(rotas, pendentes, 
            pendentes.reduce((acc, p) => acc + p.PESO, 0), 
            pendentes.reduce((acc, p) => acc + p.VALOR, 0), 
            cd, prefixoNome);
        return rotas;
    }

    while(pendentes.length > 0) {
        let melhorIdx = -1;
        let menorDist = Infinity;
        
        pendentes.forEach((p, idx) => {
            const dist = turf.distance([pontoAtual.lon, pontoAtual.lat], [p.lon, p.lat]);
            if(dist < menorDist) { menorDist = dist; melhorIdx = idx; }
        });
        
        const cand = pendentes[melhorIdx];
        
        if (pesoAtual + cand.PESO > LIMIT_PESO && rotaAtual.length > 0) {
            fecharRota(rotas, rotaAtual, pesoAtual, valorAtual, cd, prefixoNome);
            rotaAtual = []; pesoAtual = 0; valorAtual = 0;
            pontoAtual = { lat: cd.coords[1], lon: cd.coords[0] };
        } else {
            rotaAtual.push(cand);
            pesoAtual += cand.PESO;
            valorAtual += cand.VALOR;
            pontoAtual = cand;
            pendentes.splice(melhorIdx, 1);
        }
    }
    if(rotaAtual.length > 0) fecharRota(rotas, rotaAtual, pesoAtual, valorAtual, cd, prefixoNome);
    
    return rotas;
}

function fecharRota(listaDestino, pedidos, peso, valor, origem, prefixo) {
    const veiculo = peso <= 12000 ? "Truck" : (peso <= 27000 ? "Carreta" : "Macro/Excedente");
    const custoKm = peso <= 12000 ? CUSTO_TRUCK : CUSTO_CARRETA;
    listaDestino.push({
        rota_nome: `${prefixo} ${prefixo.includes('MACRO') ? '' : '#' + (listaDestino.length + 1)}`,
        pedidos: [...pedidos],
        peso_total: peso,
        valor_total: valor,
        veiculo: veiculo,
        custo_km_base: custoKm,
        origem: origem
    });
}

function calcularMelhorFracionado(rota) {
    const uf = rota.pedidos[0]?.UF;
    if (!uf || !transportadoresCache.length) return { valor: rota.valor_total * PCT_FRACIONADO, nome: "Tabela Padrão (4%)" };
    
    let melhorPreco = Infinity; 
    let melhorTransp = "Tabela Padrão (4%)"; 
    let encontrou = false;
    
    transportadoresCache.forEach(t => {
        if (t.ufs_atendidas && t.ufs_atendidas.toUpperCase().includes(uf.toUpperCase())) {
            const precoKg = t.preco_kg || 0; 
            const pedagio = t.pedagio || 0; 
            const adValorem = t.ad_valorem ? (t.ad_valorem / 100) : 0;
            const gris = t.gris ? (t.gris / 100) : 0; 
            const outrosPct = t.outros_pct ? (t.outros_pct / 100) : 0;
            const taxaFixa = t.taxa_fixa || 0; 
            const tas = t.tas || 0; 
            const minimo = t.frete_minimo || 0;
            
            const custoPeso = (rota.peso_total * precoKg) + ((rota.peso_total / 100) * pedagio);
            const custoValor = rota.valor_total * (adValorem + gris + outrosPct);
            const custoTaxas = taxaFixa + tas;
            
            let total = custoPeso + custoValor + custoTaxas;
            if (total < minimo) total = minimo;
            
            if (total < melhorPreco) { 
                melhorPreco = total; 
                melhorTransp = t.nome; 
                encontrou = true; 
            }
        }
    });
    
    return encontrou ? { valor: melhorPreco, nome: melhorTransp } : { valor: rota.valor_total * PCT_FRACIONADO, nome: `Sem transp. p/ ${uf} (4%)` };
}

function mostrarResultados() {
    document.getElementById('inputSection').style.display='none'; 
    document.getElementById('resultSection').style.display='block';
    
    const container = document.getElementById('cardsContainer'); 
    container.innerHTML = "";
    
    rotasGeradas.forEach((r, idx) => {
        const resultadoFrac = calcularMelhorFracionado(r);
        r.frete_manual_fra = resultadoFrac.valor; 
        r.transportadora_sugerida = resultadoFrac.nome;
        
        let weightPct = (r.peso_total / LIMIT_PESO) * 100; 
        if(weightPct > 100) weightPct = 100;
        let barColor = weightPct > 92 ? 'bg-danger' : (weightPct > 70 ? 'bg-warning' : 'bg-success');
        
        const nomeRota = r.rota_nome || `Rota #${idx+1}`;
        const isMacro = nomeRota.includes("MACRO") || nomeRota.includes("RESTANTES");
        
        const cardStyle = isMacro ? "border: 2px solid #6f42c1; background-color: #f8f9fa;" : (nomeRota.includes("ROTA") ? "border-left: 5px solid #0dcaf0;" : "border-left: 5px solid #0d6efd;");
        const badgeColor = isMacro ? "bg-purple text-white" : "bg-dark";

        const isItineranteBetter = (r.frete_manual_iti || 0) < resultadoFrac.valor;
        const checkIti = isItineranteBetter ? "checked" : ""; 
        const checkFra = !isItineranteBetter ? "checked" : "";
        
        container.innerHTML += `
        <div class="route-card" onclick="verRotaNoMapa(${idx})" style="${cardStyle}">
            
            <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center" style="max-width: 75%; overflow: hidden;">
                    <h6 class="text-primary fw-bold mb-0 text-truncate" title="${nomeRota}">${nomeRota}</h6>
                    <button class="btn btn-link btn-sm p-0 ms-2 text-secondary" onclick="window.renomearRota(${idx}); event.stopPropagation()" title="Renomear Rota">
                        <i class="fas fa-pen" style="font-size: 0.8rem;"></i>
                    </button>
                </div>
                <span class="badge ${badgeColor}" style="${isMacro ? 'background-color: #6f42c1;' : ''}">${r.veiculo}</span>
            </div>

            <small class="text-muted d-block mb-2">${r.pedidos.length} peds • ${(r.peso_total/1000).toFixed(1)} ton</small>
            
            <div class="weight-progress-container">
                <div class="progress-track">
                    <div class="progress-fill ${barColor}" style="width: ${weightPct.toFixed(1)}%;"></div>
                </div>
            </div>
            <div class="progress-labels">
                <span>${r.peso_total.toLocaleString('pt-BR')} kg</span>
                <span>Cap: ${LIMIT_PESO.toLocaleString('pt-BR')} kg</span>
            </div>
            
            <div class="freight-inputs-container mt-2" onclick="event.stopPropagation()">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="form-check d-flex align-items-center" style="max-width: 65%; overflow: hidden;">
                        <input class="form-check-input" type="radio" name="escolha_${idx}" id="radIti_${idx}" value="ITI" ${checkIti}>
                        <label class="form-check-label small fw-bold text-truncate ms-1" for="radIti_${idx}" title="Itinerante">Itinerante</label>
                    </div>
                    <input type="number" class="freight-input" id="inIti_${idx}" onchange="recalc(${idx})" style="width: 90px; font-size:0.8rem;">
                </div>
                <div class="d-flex justify-content-end mb-2" style="font-size: 0.65rem; color: #6c757d;">
                    <span id="statsIti_${idx}">--% | R$--/kg | R$--/km</span>
                </div>

                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="form-check d-flex align-items-center" style="max-width: 65%; overflow: hidden;">
                        <input class="form-check-input" type="radio" name="escolha_${idx}" id="radFra_${idx}" value="FRA" ${checkFra}>
                        <label class="form-check-label small fw-bold text-truncate ms-1" for="radFra_${idx}" title="${resultadoFrac.nome}">${resultadoFrac.nome}</label>
                    </div>
                    <input type="number" class="freight-input" id="inFra_${idx}" value="${resultadoFrac.valor.toFixed(2)}" onchange="recalc(${idx})" style="width: 90px; font-size:0.8rem;">
                </div>
                <div class="d-flex justify-content-end" style="font-size: 0.65rem; color: #6c757d;">
                    <span id="statsFra_${idx}">--% | R$--/kg | R$--/km</span>
                </div>
            </div>
            
            <div id="listaPedidos_${idx}" class="lista-pedidos-container" style="display:none;" onclick="event.stopPropagation()"></div>

            <div class="route-actions mt-2 border-top pt-2 d-flex justify-content-between">
                <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.toggleListaPedidos(${idx}); event.stopPropagation()">
                    <i class="fas fa-list"></i> EDITAR
                </button>
                <div>
                    <button class="btn-action-icon text-success" onclick="window.abrirGoogleMaps(${idx}); event.stopPropagation()"><i class="fas fa-map-marked-alt"></i></button>
                    <button class="btn-action-icon text-dark" onclick="window.gerarPDF(${idx}); event.stopPropagation()"><i class="fas fa-file-pdf"></i></button>
                    <button class="btn-action-icon text-primary fw-bold" onclick="window.salvarRotaFirestore(${idx}); event.stopPropagation()"><i class="fas fa-save"></i></button>
                </div>
            </div>
        </div>`;
    });
    
    rotasGeradas.forEach((_, idx) => recalc(idx));

    if(rotasGeradas.length > 0) verRotaNoMapa(0);
}

window.toggleListaPedidos = function(idx) {
    const divLista = document.getElementById(`listaPedidos_${idx}`);
    if (divLista.style.display === 'none') {
        renderizarListaPedidos(idx); 
        divLista.style.display = 'block';
    } else {
        divLista.style.display = 'none';
    }
};

function renderizarListaPedidos(idx) {
    const rota = rotasGeradas[idx];
    const divLista = document.getElementById(`listaPedidos_${idx}`);
    let html = '';
    rota.pedidos.forEach((p, i) => {
        const iconAuxilio = (p.DESCARGA && p.DESCARGA.toString().toUpperCase().includes("COM")) 
            ? '<i class="fas fa-people-carry text-warning ms-1" title="Com Auxílio"></i>' : '';
        html += `
        <div class="lista-row">
            <div style="flex: 1;">
                <span class="badge rounded-pill bg-primary me-1" style="font-size: 0.7em;">${i+1}</span>
                <small class="fw-bold">${p.ID}</small> ${iconAuxilio}
                <br>
                <small class="text-muted" style="font-size: 0.75rem;">${p.ENDERECO.substring(0,25)}...</small>
            </div>
            <div class="text-end" style="flex: 0 0 80px;">
                <small class="d-block fw-bold text-success">R$${p.VALOR.toLocaleString('pt-BR', {minimumFractionDigits:0})}</small>
                <small class="d-block text-secondary">${p.PESO}kg</small>
            </div>
            <div class="ms-2">
                <i class="fas fa-times-circle text-danger" style="cursor:pointer; font-size:1.1rem;" onclick="window.removerPedidoDaRota(${idx}, ${i})" title="Remover"></i>
            </div>
        </div>`;
    });
    divLista.innerHTML = html;
}

window.removerPedidoDaRota = function(rIdx, pIdx) {
    const pedido = rotasGeradas[rIdx].pedidos.splice(pIdx, 1)[0];
    recalcularRotaInfo(rotasGeradas[rIdx]);
    
    let idxRestantes = rotasGeradas.findIndex(r => r.rota_nome.includes("ROTA RESTANTES"));
    if (idxRestantes === -1) {
        const novaRota = {
            rota_nome: "ROTA RESTANTES (" + new Date().toLocaleDateString() + ")",
            pedidos: [pedido], peso_total: 0, valor_total: 0, 
            veiculo: "Pendente", custo_km_base: CUSTO_TRUCK, origem: rotasGeradas[rIdx].origem,
            distancia_calculada: 0
        };
        rotasGeradas.push(novaRota); 
    } else { 
        rotasGeradas[idxRestantes].pedidos.push(pedido); 
        recalcularRotaInfo(rotasGeradas[idxRestantes]);
    }
    
    mostrarResultados(); 
    verRotaNoMapa(rIdx);
    if (rotasGeradas[rIdx] && rotasGeradas[rIdx].pedidos.length > 0) { window.toggleListaPedidos(rIdx); }
};

function recalcularRotaInfo(rota) {
    rota.peso_total = rota.pedidos.reduce((acc, p) => acc + p.PESO, 0);
    rota.valor_total = rota.pedidos.reduce((acc, p) => acc + p.VALOR, 0);
    rota.veiculo = rota.peso_total <= 12000 ? "Truck" : (rota.peso_total <= 27000 ? "Carreta" : "Macro/Excedente");
    rota.custo_km_base = rota.peso_total <= 12000 ? CUSTO_TRUCK : CUSTO_CARRETA;
}

window.toggleRouteVisibility = function() {
    const isChecked = document.getElementById('toggleRouteLine')?.checked;
    const visibility = (isChecked === undefined || isChecked) ? 'visible' : 'none';
    if (map.getLayer('route')) { map.setLayoutProperty('route', 'visibility', visibility); }
};

// ==============================================================
// VISUALIZAÇÃO NO MAPA (COM CÁLCULO DE DIAS E PRAZOS)
// ==============================================================

async function verRotaNoMapa(idx) {
    limparMapa(); currentRouteIndex = idx; const rota = rotasGeradas[idx];
    const allCoords = [rota.origem.coords, ...rota.pedidos.map(p => [p.lon, p.lat])];
    
    const titulo = rota.id_operacao ? `[${rota.id_operacao}] ${rota.rota_nome}` : rota.rota_nome;
    document.getElementById('statNome').innerText = titulo;
    document.getElementById('statVeiculo').innerText = rota.veiculo;
    const valorFormatado = rota.valor_total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    document.getElementById('statValor').innerText = valorFormatado;

    new mapboxgl.Marker({color:'red'}).setLngLat(rota.origem.coords).setPopup(new mapboxgl.Popup().setHTML(`<b>ORIGEM: ${rota.origem.nome}</b>`)).addTo(map);
    
    rota.pedidos.forEach((p, i) => {
        const el = document.createElement('div'); 
        if(rota.pedidos.length > 30) {
            el.style.cssText = "background:#6f42c1; width:10px; height:10px; border-radius:50%; border:1px solid white; cursor:pointer;";
        } else {
            el.style.cssText = "background:#0d6efd; color:white; width:24px; height:24px; border-radius:50%; text-align:center; font-weight:bold; border:2px solid white;"; 
            el.innerText = i+1;
        }
        let btnMover = ""; let melhorCD = null; let menorDist = Infinity;
        CDS_FOTUS.forEach(cd => { if(cd.key !== currentCD) { const d = turf.distance([p.lon, p.lat], cd.coords); if(d < menorDist) { menorDist = d; melhorCD = cd; } } });
        if(melhorCD) btnMover = `<button class="btn btn-sm btn-warning w-100 mt-1" onclick="window.moverParaOutroCD('${melhorCD.key}', ${idx}, ${i})">Mover p/ ${melhorCD.nome}</button>`;
        let badgeDescarga = ""; if (p.DESCARGA && p.DESCARGA.toString().toUpperCase().includes("COM")) { badgeDescarga = `<span class="badge bg-warning text-dark mb-1"><i class="fas fa-people-carry"></i> Com Auxílio</span><br>`; }
        
        const popupHTML = `<div class="text-center"><b>${p.ID}</b><br>${p.ENDERECO}<br><div class="my-1 fw-bold text-success">NF: R$ ${p.VALOR.toLocaleString('pt-BR')}</div>${badgeDescarga}<span class="badge bg-secondary">${p.PESO}kg</span><hr class="my-1"><button class="btn btn-sm btn-danger w-100" onclick="window.removerPedidoDaRota(${idx}, ${i})">Remover</button>${btnMover}</div>`;
        
        const m = new mapboxgl.Marker(el).setLngLat([p.lon, p.lat]).setPopup(new mapboxgl.Popup().setHTML(popupHTML)).addTo(map);
        markers.push(m); 
    });
    
    document.getElementById('routeStats').style.display='block';
    document.getElementById('financePanel').style.display='flex';
    
    if(allCoords.length > 1) {
        const MAX_WAYPOINTS = 25; const chunks = [];
        for (let i = 0; i < allCoords.length - 1; i += (MAX_WAYPOINTS - 1)) {
            const chunk = allCoords.slice(i, i + MAX_WAYPOINTS);
            if(chunk.length > 1) chunks.push(chunk);
        }
        try {
            const promises = chunks.map(chunk => {
                const waypoints = chunk.map(c => c.join(',')).join(';');
                const exclude = document.getElementById('flagPedagio').checked ? '&exclude=toll' : '';
                return fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?geometries=geojson&access_token=${MAPBOX_KEY}${exclude}`).then(res => res.json());
            });
            const results = await Promise.all(promises);
            let fullGeometry = { type: 'LineString', coordinates: [] };
            let totalDist = 0; let totalDur = 0;
            results.forEach(data => {
                if (data.routes && data.routes[0]) {
                    fullGeometry.coordinates.push(...data.routes[0].geometry.coordinates);
                    totalDist += data.routes[0].distance; totalDur += data.routes[0].duration;
                }
            });
            const distKm = totalDist / 1000; 
            const durMin = totalDur / 60; // Minutos totais
            rota.distancia_calculada = distKm; 
            
            document.getElementById('statDist').innerText = distKm.toFixed(1) + " km";

            // --- CÁLCULO DE TEMPO EM DIAS ---
            const horasTotais = Math.floor(durMin / 60);
            const minutosRestantes = Math.floor(durMin % 60);
            let tempoFormatado = "";
            
            if (horasTotais >= 24) {
                const dias = Math.floor(horasTotais / 24);
                const horasSobrando = horasTotais % 24;
                tempoFormatado = `${dias}d ${horasSobrando}h ${minutosRestantes}m`;
            } else {
                tempoFormatado = `${horasTotais}h ${minutosRestantes}m`;
            }
            document.getElementById('statTempoTotal').innerText = tempoFormatado;

            // --- ESTIMATIVA DE PRAZO FRACIONADO ---
            if(distKm > 0) {
                const diasFrac = Math.ceil(distKm / 350) + 2;
                const elPrazo = document.getElementById('statPrazoFrac');
                if(elPrazo) elPrazo.innerText = `~${diasFrac} a ${diasFrac + 1} dias úteis`;
            } else {
                const elPrazo = document.getElementById('statPrazoFrac');
                if(elPrazo) elPrazo.innerText = "--";
            }

            let custoRisco = 0; let nomesRisco = [];
            const line = turf.lineString(fullGeometry.coordinates); 
            risksCache.forEach(r => { if(r.lat && r.lon) { const circle = turf.circle([r.lon, r.lat], r.raio/1000); if(turf.booleanIntersects(line, circle)) { custoRisco += (parseFloat(r.custo_extra)||0); nomesRisco.push(r.descricao); } } });
            const alertBox = document.getElementById('riskAlertBox');
            if(custoRisco > 0) { alertBox.style.display='block'; alertBox.innerHTML = `⚠️ Risco: ${nomesRisco.join(', ')} (+R$ ${custoRisco})`; } else { alertBox.style.display='none'; }
            rota.custo_calculado = (distKm * rota.custo_km_base) + custoRisco;
            const isVisible = document.getElementById('toggleRouteLine')?.checked !== false ? 'visible' : 'none';
            if (map.getSource('route')) { map.getSource('route').setData({type:'Feature', geometry: fullGeometry}); map.setLayoutProperty('route', 'visibility', isVisible); } 
            else { map.addSource('route', { type: 'geojson', data: {type:'Feature', geometry: fullGeometry} }); map.addLayer({id:'route', type:'line', source:'route', layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': isVisible }, paint:{'line-color':'#0d6efd', 'line-width':4}}); }
            const b = new mapboxgl.LngLatBounds(); allCoords.forEach(c => b.extend(c)); map.fitBounds(b, {padding: 50});
        } catch(e) { console.error(e); }
    }
    const inIti = document.getElementById(`inIti_${idx}`);
    if(!inIti.value) inIti.value = rota.custo_calculado ? rota.custo_calculado.toFixed(2) : 0;
    recalc(idx);
}

// ==============================================================
// FUNÇÕES AUXILIARES, CÁLCULOS FINAIS E FIREBASE
// ==============================================================

function recalc(idx) {
    const r = rotasGeradas[idx];
    let valIti = parseFloat(document.getElementById(`inIti_${idx}`).value);
    if (isNaN(valIti)) valIti = r.frete_manual_iti || 0;
    
    let valFra = parseFloat(document.getElementById(`inFra_${idx}`).value);
    if (isNaN(valFra)) valFra = r.frete_manual_fra || 0;
    
    const inpIti = document.getElementById(`inIti_${idx}`); const inpFra = document.getElementById(`inFra_${idx}`);
    if(inpIti && inpIti.value === "") inpIti.value = valIti.toFixed(2);
    if(inpFra && inpFra.value === "") inpFra.value = valFra.toFixed(2);

    const pctIti = r.valor_total > 0 ? (valIti / r.valor_total) * 100 : 0;
    const pctFra = r.valor_total > 0 ? (valFra / r.valor_total) * 100 : 0;
    const peso = r.peso_total > 0 ? r.peso_total : 1;
    const km = r.distancia_calculada > 0 ? r.distancia_calculada : 1;
    const kgIti = valIti / peso; const kgFra = valFra / peso; const kmIti = valIti / km; const kmFra = valFra / km;

    const elValIti = document.getElementById('valItinerante');
    if(elValIti) {
        elValIti.innerText = valIti.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
        document.getElementById('pctItinerante').innerText = pctIti.toFixed(2) + "%";
        document.getElementById('valFracionado').innerText = valFra.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
        document.getElementById('pctFracionado').innerText = pctFra.toFixed(2) + "%";
        const cardI = document.getElementById('cardItinerante'); const cardF = document.getElementById('cardFracionado');
        cardI.className = "finance-card"; cardF.className = "finance-card";
        document.getElementById('econItinerante').innerText = ""; document.getElementById('econFracionado').innerText = "";
        if(valIti < valFra) { cardI.classList.add('winner'); document.getElementById('econItinerante').innerText = "Economia: " + (valFra - valIti).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}); } 
        else { cardF.classList.add('winner'); document.getElementById('econFracionado').innerText = "Economia: " + (valIti - valFra).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}); }
    }
    const elStatsIti = document.getElementById(`statsIti_${idx}`);
    const elStatsFra = document.getElementById(`statsFra_${idx}`);
    if(elStatsIti) elStatsIti.innerText = `${pctIti.toFixed(2)}% | R$ ${kgIti.toFixed(2)}/kg | R$ ${kmIti.toFixed(2)}/km`;
    if(elStatsFra) elStatsFra.innerText = `${pctFra.toFixed(2)}% | R$ ${kgFra.toFixed(2)}/kg | R$ ${kmFra.toFixed(2)}/km`;
    r.frete_manual_iti = valIti; r.frete_manual_fra = valFra;
}

window.carregarDashboard = function() {
    const elEconomia = document.getElementById('kpiEconomia'); 
    if(elEconomia) elEconomia.innerText = "Carregando...";
    db.collection("historico").get().then(q => {
        let totalEconomia = 0; let countIti = 0; let countFra = 0; let gastoTotal = 0;
        q.forEach(doc => {
            const d = doc.data();
            if (d.economia_gerada !== undefined) {
                totalEconomia += parseFloat(d.economia_gerada); gastoTotal += parseFloat(d.valor_frete);
                if (d.modalidade_escolhida === "ITINERANTE") countIti++; if (d.modalidade_escolhida === "FRACIONADO") countFra++;
            }
        });
        if(elEconomia) elEconomia.innerText = totalEconomia.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
        document.getElementById('kpiGasto').innerText = gastoTotal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
        document.getElementById('kpiQtd').innerText = q.size;
        renderChart(countIti, countFra);
    });
}

window.salvarRotaFirestore = function(idx) {
    const r = rotasGeradas[idx];
    const opId = "OP-" + Math.floor(Date.now() / 1000).toString().slice(-6); 
    const valIti = parseFloat(document.getElementById(`inIti_${idx}`).value) || 0;
    const valFra = parseFloat(document.getElementById(`inFra_${idx}`).value) || 0;
    const isItiChecked = document.getElementById(`radIti_${idx}`).checked;
    let economia = isItiChecked ? (valFra - valIti) : (valIti - valFra);
    let escolha = isItiChecked ? "ITINERANTE" : "FRACIONADO";
    const obj = {
        id_operacao: opId, criado_por: currentUser.nome, filial_origem: currentUser.cd,
        nome_rota: r.rota_nome, veiculo: r.veiculo || "N/A", total_km: r.distancia_calculada || 0, 
        valor_frete: isItiChecked ? valIti : valFra, modalidade_escolhida: escolha, economia_gerada: economia,
        data_criacao: new Date().toISOString(),
        dados_json: JSON.stringify({ 
            id_operacao: opId, pedidos: r.pedidos, origem: r.origem, peso_total: r.peso_total, 
            valor_total: r.valor_total, frete_manual_iti: valIti, frete_manual_fra: valFra, 
            veiculo: r.veiculo, transp_sugerido: r.transportadora_sugerida, distancia_calculada: r.distancia_calculada 
        }),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection("historico").add(obj).then(() => { alert(`✅ Salvo! ID: ${opId}\nModalidade: ${escolha}\nEconomia: R$ ${economia.toLocaleString('pt-BR')}`); window.carregarDashboard(); }).catch(err => { console.error(err); alert("Erro ao salvar: " + err.message); });
};

window.moverParaOutroCD = function(targetKey, rIdx, pIdx) {
    if(!confirm(`Mover para ${targetKey}?`)) return;
    const p = rotasGeradas[rIdx].pedidos[pIdx]; pedidosPorCD[targetKey].push(p);
    window.removerPedidoDaRota(rIdx, pIdx); alert("Movido com sucesso!");
};

window.abrirGoogleMaps = function(idx) { 
    const r = rotasGeradas[idx]; const o = `${r.origem.coords[1]},${r.origem.coords[0]}`; 
    const d = r.pedidos.map(p => `${p.lat},${p.lon}`).join('/'); window.open(`https://www.google.com/maps/dir/${o}/${d}`, '_blank'); 
};

window.gerarPDF = function(idx) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF(); const r = rotasGeradas[idx];
    const valIti = parseFloat(document.getElementById(`inIti_${idx}`).value) || r.frete_manual_iti;
    const valFra = parseFloat(document.getElementById(`inFra_${idx}`).value) || r.frete_manual_fra;
    doc.setFontSize(18); doc.text("MANIFESTO DE CARGA - FOTUS", 14, 20); doc.setFontSize(10);
    const titulo = r.id_operacao ? `[${r.id_operacao}] ${r.rota_nome}` : r.rota_nome;
    doc.text(`Rota: ${titulo}`, 14, 30); 
    doc.text(`Veículo: ${r.veiculo} | Data: ${new Date().toLocaleDateString()}`, 14, 35);
    const rows = r.pedidos.map((p, i) => [i+1, p.ID, p.ENDERECO, `${p.PESO} kg`, `R$ ${p.VALOR.toLocaleString('pt-BR')}`]);
    doc.autoTable({ startY: 40, head: [['Seq', 'Pedido', 'Endereço', 'Peso', 'Valor']], body: rows });
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.text(`Peso Total: ${r.peso_total} kg`, 14, finalY); doc.text(`Valor Total: R$ ${r.valor_total.toLocaleString('pt-BR')}`, 14, finalY+7);
    doc.text(`Frete Itinerante: R$ ${valIti.toLocaleString('pt-BR')}`, 14, finalY+14); doc.text(`Frete Tabela: R$ ${valFra.toLocaleString('pt-BR')}`, 14, finalY+21); doc.save(`Manifesto_${r.rota_nome}.pdf`);
};

window.carregarHistorico = function() {
    const div = document.getElementById('historyList'); div.innerHTML = "<div class='text-center py-3'><i class='fas fa-spinner fa-spin'></i> Carregando...</div>";
    db.collection("historico").orderBy("data_criacao", "desc").limit(20).get().then(q => {
        historicoCache = []; div.innerHTML = ""; if(q.empty) { div.innerHTML = "<div class='text-center text-muted small p-3'>Nenhuma rota salva ainda.</div>"; return; }
        let i = 0;
        q.forEach(doc => {
            const d = doc.data(); historicoCache.push(d); 
            const dt = d.data_criacao ? new Date(d.data_criacao).toLocaleDateString() : "-";
            const idOp = d.id_operacao ? `<span class="badge bg-dark me-2" style="font-size:0.7em">${d.id_operacao}</span>` : "";
            const criador = d.criado_por ? `<div class="text-muted mt-1" style="font-size:0.7em"><i class="fas fa-user-circle"></i> ${d.criado_por} (${d.filial_origem || '?'})</div>` : "";
            div.innerHTML += `<div class="history-item p-3 mb-2 border rounded bg-white shadow-sm"><div class="d-flex justify-content-between align-items-start cursor-pointer" onclick="window.restaurarRota(${i})"><div>${idOp} <strong class="text-primary">${d.nome_rota}</strong><div class="small text-muted mt-1"><i class="far fa-calendar-alt"></i> ${dt} • <i class="fas fa-truck"></i> ${d.veiculo}</div>${criador}</div><div class="text-end"><span class="badge bg-success mb-1">R$ ${d.valor_frete.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</span></div></div><hr class="my-2"><div class="d-flex gap-2"><button class="btn btn-sm btn-outline-primary flex-grow-1 fw-bold" onclick="window.restaurarRota(${i})"><i class="fas fa-map-marked-alt"></i> ABRIR</button><button class="btn btn-sm btn-warning flex-grow-1 fw-bold text-dark" onclick="window.prepararCotacao(${i})"><i class="fas fa-bullhorn"></i> COTAR / LEILOAR</button><button class="btn btn-sm btn-outline-danger" onclick="delDoc('historico','${doc.id}')" title="Excluir"><i class="fas fa-trash"></i></button></div></div>`;
            i++;
        });
    });
}

window.restaurarRota = function(idx) {
    if(confirm("Abrir esta rota?")) {
        const dadosRaw = historicoCache[idx];
        const dados = JSON.parse(dadosRaw.dados_json);
        if(!dados.rota_nome) dados.rota_nome = dadosRaw.nome_rota; 
        if(!dados.id_operacao) dados.id_operacao = dadosRaw.id_operacao;
        rotasGeradas = [dados];
        document.querySelector('#home-tab').click(); 
        document.getElementById('inputSection').style.display='none'; document.getElementById('resultSection').style.display='block';
        mostrarResultados(); setTimeout(() => verRotaNoMapa(0), 500); 
    }
}

// --- FUNÇÃO ATUALIZADA: MENSAGEM WHATSAPP MELHORADA ---
window.prepararCotacao = function(idx) {
    const dadosRaw = historicoCache[idx];
    const dados = JSON.parse(dadosRaw.dados_json);
    
    // Dados Básicos
    const rotaNome = dadosRaw.nome_rota || "Rota";
    const origem = dados.origem ? dados.origem.nome : "CD Origem";
    const pesoTotal = (dados.peso_total / 1000).toFixed(2); 
    const valorCarga = dados.valor_total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    const veiculo = dadosRaw.veiculo;
    const idOp = dadosRaw.id_operacao || "N/A";
    
    // Pega as cidades/região
    const ufs = [...new Set(dados.pedidos.map(p => { 
        if(p.UF) return p.UF; 
        const parts = p.ENDERECO.split('-'); 
        return parts.length > 1 ? parts[parts.length-1].trim().substring(0,2) : "BR"; 
    }))].join(', ');

   // --- DENTRO DA FUNÇÃO window.prepararCotacao ---

    // ... (código anterior mantido) ...

    // --- GERAÇÃO DO LINK INTELIGENTE (ATUALIZADO PARA PASTAS) ---
    
    // Pega o domínio principal (ex: https://roteirizadorfotus.web.app)
    const dominio = window.location.origin;
    
    // Monta o link apontando para a pasta vizinha "transportador"
    const linkPortal = `${dominio}/transportador/?op=${idOp}`;

    // MONTA O TEXTO DA COTAÇÃO
    textoCotacaoAtual = 
`🚛 *COTAÇÃO DE FRETE - FOTUS*
--------------------------------
🆔 *ID:* ${idOp}
📍 *Origem:* ${origem}
🌎 *Região:* ${ufs}
🚛 *Veículo:* ${veiculo} (${pesoTotal} ton)
💰 *Valor Carga:* ${valorCarga}

👇 *ACESSE O LINK PARA ENVIAR SEU VALOR:*
${linkPortal}

_Favor preencher o link acima para registrar sua oferta no sistema._`;

    // ... (restante do código igual) ...
    // Joga no textarea do modal
    document.getElementById('textoCotacao').value = textoCotacaoAtual;
    
    const modal = new bootstrap.Modal(document.getElementById('modalCotacao'));
    modal.show();
};

window.enviarWhatsAppCotacao = function() {
    const textoEncoded = encodeURIComponent(textoCotacaoAtual);
    window.open(`https://api.whatsapp.com/send?text=${textoEncoded}`, '_blank');
};

window.copiarTextoCotacao = function() {
    const txt = document.getElementById('textoCotacao'); txt.select(); document.execCommand('copy'); 
    const btn = event.target.closest('button'); const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-check"></i> COPIADO!`; setTimeout(() => btn.innerHTML = originalHtml, 2000);
};

function renderChart(iti, fra) {
    const ctx = document.getElementById('kpiChart'); if (!ctx) return; 
    if (kpiChartInstance) kpiChartInstance.destroy();
    kpiChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Itinerante', 'Fracionado'], datasets: [{ data: [iti, fra], backgroundColor: ['#22c55e', '#3b82f6'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
}
function exportarBackupCompleto() { 
    const dtInicio = document.getElementById('dateStart').value; const dtFim = document.getElementById('dateEnd').value;
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalExport')); if(modal) modal.hide();
    showLoading(true, "Gerando Relatório...");
    db.collection("historico").orderBy("data_criacao", "desc").get().then(q => {
        const dadosLimpos = [];
        q.forEach(doc => {
            const d = doc.data(); const dataRota = d.data_criacao.split('T')[0];
            if (dtInicio && dataRota < dtInicio) return; if (dtFim && dataRota > dtFim) return;
            let det = {}; try { det = JSON.parse(d.dados_json); } catch(e) {}
            const cIti = parseFloat(d.valor_frete) || 0; const cFra = det.frete_manual_fra || 0;
            dadosLimpos.push({
                "ID Operação": d.id_operacao || "-", "Responsável": d.criado_por || "-", "Filial Origem": d.filial_origem || "-",
                "Data": new Date(d.data_criacao).toLocaleDateString(), "Rota": d.nome_rota, "Veículo": d.veiculo,
                "Origem": det.origem ? det.origem.nome : "N/A", "Qtd Pedidos": det.pedidos ? det.pedidos.length : 0,
                "Peso Total": det.peso_total || 0, "Valor Carga": det.valor_total || 0, "KM Total": d.total_km || 0,
                "Custo Real": cIti, "Custo Tabela": cFra, "Economia": Math.abs(cFra - cIti),
                "Melhor Opção": cIti < cFra ? "ITINERANTE" : "FRACIONADO", "% do Frete": det.valor_total ? (cIti / det.valor_total * 100).toFixed(2) + "%" : "0%"
            });
        });
        if (dadosLimpos.length === 0) { showLoading(false); return alert("Sem dados."); }
        const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(dadosLimpos);
        XLSX.utils.book_append_sheet(wb, ws, "Relatorio"); XLSX.writeFile(wb, `TMS_Relatorio_${new Date().toISOString().slice(0,10)}.xlsx`); showLoading(false);
    });
}
function delDoc(col, id) { if(confirm("Apagar?")) db.collection(col).doc(id).delete().then(() => { if(col==='historico') carregarHistorico(); if(col==='riscos') carregarRiscos(); if(col==='transportadores') carregarTransportadores(); }); }
async function salvarRisco() {
    const addr = document.getElementById('riskAddr').value; if(!addr) return;
    try { const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${MAPBOX_KEY}&limit=1`); const d = await res.json();
    if(d.features?.length) db.collection("areas_risco").add({ descricao: document.getElementById('riskDesc').value, custo_extra: parseFloat(document.getElementById('riskCost').value), raio: parseInt(document.getElementById('riskRadius').value), lat: d.features[0].center[1], lon: d.features[0].center[0] }).then(()=>{alert("Salvo!"); carregarRiscos();});
    } catch(e){}
}
function carregarRiscos() { 
    db.collection("areas_risco").get().then(q => { risksCache = []; const div = document.getElementById('listaRiscos'); div.innerHTML=""; q.forEach(doc=>{ const d=doc.data(); risksCache.push(d); div.innerHTML+=`<div class="d-flex justify-content-between border-bottom p-1"><span onclick="window.irParaRisco(${d.lat}, ${d.lon})" style="cursor:pointer; color:#dc3545; font-weight:bold;">${d.descricao}</span><i class="fas fa-trash text-danger" onclick="delDoc('areas_risco','${doc.id}')"></i></div>`; }); desenharRiscosNoMapa(); }); 
}
function desenharRiscosNoMapa() {
    if (map.getLayer('riscos-layer')) map.removeLayer('riscos-layer');
    if (map.getSource('riscos-source')) map.removeSource('riscos-source');
    const features = risksCache.map(r => { if(r.lat && r.lon) { return turf.circle([r.lon, r.lat], r.raio/1000, {steps: 64, units: 'kilometers', properties: {description: r.descricao}}); } }).filter(f => f);
    if(features.length > 0) { map.addSource('riscos-source', { type: 'geojson', data: { type: 'FeatureCollection', features: features } }); map.addLayer({ id: 'riscos-layer', type: 'fill', source: 'riscos-source', layout: {}, paint: { 'fill-color': '#dc3545', 'fill-opacity': 0.3 } }); }
}
window.irParaRisco = function(lat, lon) { if(lat && lon) { map.flyTo({ center: [lon, lat], zoom: 12, speed: 1.5 }); } };
function salvarTransportadora() {
    const nome = document.getElementById('transpNome').value; if(!nome) return alert("Nome obrigatório!");
    const data = { nome: nome, ufs_atendidas: document.getElementById('transpUfs').value.toUpperCase(), preco_kg: parseFloat(document.getElementById('transpPrecoKg').value)||0, pedagio: parseFloat(document.getElementById('transpPedagio').value)||0, ad_valorem: parseFloat(document.getElementById('transpAdValorem').value)||0, gris: parseFloat(document.getElementById('transpGris').value)||0, outros_pct: parseFloat(document.getElementById('transpOutrosPct').value)||0, taxa_fixa: parseFloat(document.getElementById('transpTaxa').value)||0, tas: parseFloat(document.getElementById('transpTas').value)||0, frete_minimo: parseFloat(document.getElementById('transpMinimo').value)||0 };
    db.collection("transportadores").add(data).then(()=>{ alert("Tabela Salva!"); carregarTransportadores(); });
}
function carregarTransportadores() { 
    db.collection("transportadores").get().then(q => { transportadoresCache = []; const div = document.getElementById('listaTransportadores'); div.innerHTML=""; q.forEach(doc=>{ const d=doc.data(); transportadoresCache.push(d); div.innerHTML+=`<div class="d-flex justify-content-between border-bottom p-2 align-items-center"><div><strong>${d.nome}</strong> <span class="badge bg-light text-dark">${d.ufs_atendidas}</span><br><small class="text-muted">Min: R$${d.frete_minimo} • Kg: R$${d.preco_kg} • AdV: ${d.ad_valorem}%</small></div><i class="fas fa-trash text-danger" style="cursor:pointer" onclick="delDoc('transportadores','${doc.id}')"></i></div>`; }); }); 
}
function exportarModeloTabela() {
    db.collection("transportadores").get().then(q => {
        const dados = []; q.forEach(doc => { const d = doc.data(); dados.push({ "NOME": d.nome, "UF": d.ufs_atendidas, "PRECO_KG": d.preco_kg, "PEDAGIO": d.pedagio, "AD_VALOREM": d.ad_valorem, "GRIS": d.gris, "OUTROS_PCT": d.outros_pct, "TAXA": d.taxa_fixa, "TAS": d.tas, "MINIMO": d.frete_minimo }); });
        if (dados.length === 0) dados.push({ "NOME": "Exemplo", "UF": "SP", "PRECO_KG": 0.50, "PEDAGIO": 2.50, "AD_VALOREM": 0.30, "GRIS": 0.20, "OUTROS_PCT": 0, "TAXA": 150.00, "TAS": 50.00, "MINIMO": 300.00 });
        const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(dados); XLSX.utils.book_append_sheet(wb, ws, "Modelo_Tabela_TMS"); XLSX.writeFile(wb, "Modelo_Importacao_TMS.xlsx");
    });
}
async function importarTabelaTransp(input) {
    const file = input.files[0]; if (!file) return; showLoading(true, "Lendo tabela...");
    const reader = new FileReader();
    reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'});
        let targetSheet = null; let headerRowIndex = 0;
        for (let sheetName of workbook.SheetNames) { const sheet = workbook.Sheets[sheetName]; const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }); const rowIndex = rows.findIndex(row => row && row.some(cell => cell && (cell.toString().toUpperCase().includes('NOTA MAIOR LIMITANTE') || cell.toString().toUpperCase().includes('ADVALOREM') || cell.toString().toUpperCase().includes('FRETE VALOR')))); if (rowIndex !== -1) { targetSheet = sheet; headerRowIndex = rowIndex; break; } }
        if (!targetSheet) { for (let sheetName of workbook.SheetNames) { const sheet = workbook.Sheets[sheetName]; const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }); const rowIndex = rows.findIndex(row => row && row.some(cell => cell && (cell.toString().toUpperCase().trim() === 'UF' || cell.toString().toUpperCase().includes('REGIAO')))); if (rowIndex !== -1) { targetSheet = sheet; headerRowIndex = rowIndex; break; } } }
        if (!targetSheet) { showLoading(false); return alert("Tabela não encontrada."); }
        const json = XLSX.utils.sheet_to_json(targetSheet, { range: headerRowIndex, defval: "" });
        const cleanNum = (val) => { if(!val) return 0; let s = val.toString().replace("R$","").replace("%","").trim().replace(",","."); return parseFloat(s)||0; };
        const getVal = (row, keys) => { const rowKeys = Object.keys(row); for (let k of keys) { const found = rowKeys.find(rk => rk.toUpperCase().trim() === k || rk.toUpperCase().includes(k.toUpperCase())); if(found) return row[found]; } return ""; };
        let totalImportado = 0; const BATCH_SIZE = 400; 
        for (let i = 0; i < json.length; i += BATCH_SIZE) {
            const chunk = json.slice(i, i + BATCH_SIZE); const batch = db.batch(); let opsNoBatch = 0;
            chunk.forEach(row => {
                let uf = getVal(row, ['UF', 'ESTADO', 'DESTINO', 'REGIAO']);
                if (uf && uf.length > 2) { const match = uf.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/); if (match) uf = match[0]; }
                let nome = getVal(row, ['NOME', 'TRANSPORTADORA', 'PARCEIRO', 'EMPRESA']); if (!nome) nome = file.name.replace(".xlsx", "").replace(".xls", "").replace(".csv", "");
                if (uf) { const docRef = db.collection("transportadores").doc(); const obj = { nome: nome, ufs_atendidas: uf.toUpperCase().trim(), ad_valorem: cleanNum(getVal(row, ['NOTA MAIOR LIMITANTE', 'ADVALOREM', 'AD_VALOREM', 'ADV', 'FRETE VALOR'])), preco_kg: cleanNum(getVal(row, ['FRETE TONELADA', 'PRECO_KG', 'R$/KG', 'TAR_PESO', 'FRETE PESO'])), frete_minimo: cleanNum(getVal(row, ['FRETE VALOR MINIMO', 'MINIMO', 'VALOR MINIMO'])), gris: cleanNum(getVal(row, ['GRIS', 'RISCO'])), taxa_fixa: cleanNum(getVal(row, ['TAXA', 'TDE', 'DESPACHO', 'CAT', 'TAS'])), pedagio: cleanNum(getVal(row, ['PEDAGIO', 'PED'])) }; batch.set(docRef, obj); opsNoBatch++; }
            });
            if (opsNoBatch > 0) { await batch.commit(); totalImportado += opsNoBatch; document.getElementById('loading-text').innerText = `Importando... (${totalImportado})`; }
        }
        showLoading(false); alert(`${totalImportado} importados.`); carregarTransportadores();
    };
    reader.readAsArrayBuffer(file);
}
function voltarInput() { document.getElementById('resultSection').style.display='none'; document.getElementById('inputSection').style.display='block'; limparMapa(); }
function limparMapa() { markers.forEach(m => m.remove()); markers = []; if(map.getLayer('route')) { map.removeLayer('route'); map.removeSource('route'); } document.getElementById('financePanel').style.display='none'; document.getElementById('routeStats').style.display='none'; }
function showLoading(show, txt) { document.getElementById('loading').style.display = show ? 'block' : 'none'; if(txt) document.getElementById('loading-text').innerText = txt; }
// ==============================================================
// LÓGICA DE REDIMENSIONAMENTO DA SIDEBAR (NOVO)
// ==============================================================

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('dragHandle');
    
    // Variáveis para rastrear o arrasto
    let isResizing = false;

    // Quando clica na barra
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize'; // Muda cursor global
        resizer.classList.add('resizing');
        e.preventDefault(); // Evita seleção de texto
    });

    // Quando move o mouse (em qualquer lugar da tela)
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calcula nova largura baseada na posição X do mouse
        const newWidth = e.clientX;

        // Limites de segurança (Min 300px, Max 800px)
        if (newWidth > 280 && newWidth < 800) {
            sidebar.style.width = `${newWidth}px`;
        }
    });

    // Quando solta o clique
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
            resizer.classList.remove('resizing');
            
            // IMPORTANTE: Força o mapa a se reajustar ao novo tamanho
            if (map) map.resize();
        }
    });
});

// --- FUNÇÃO NOVA: RENOMEAR ROTA ---
window.renomearRota = function(idx) {
    const rota = rotasGeradas[idx];
    const novoNome = prompt("Digite o novo nome para identificação da rota:", rota.rota_nome);
    
    if (novoNome && novoNome.trim() !== "") {
        // Atualiza o nome na memória
        rota.rota_nome = novoNome.trim();
        
        // Atualiza a visualização dos cards
        mostrarResultados();
        
        // Se essa for a rota que está aberta no mapa agora, atualiza o título lá também
        if (currentRouteIndex === idx) {
            const titulo = rota.id_operacao ? `[${rota.id_operacao}] ${rota.rota_nome}` : rota.rota_nome;
            const elTitulo = document.getElementById('statNome');
            if(elTitulo) elTitulo.innerText = titulo;
        }
    }
};