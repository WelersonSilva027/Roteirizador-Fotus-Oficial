// --- CONFIGURAÇÃO ---
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

// --- INICIALIZAÇÃO ---
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
mapboxgl.accessToken = MAPBOX_KEY;

const map = new mapboxgl.Map({ container: 'map', style: 'mapbox://styles/mapbox/streets-v12', center: [-40.3842, -20.3708], zoom: 5 });

// --- CONSTANTES ---
const LIMIT_PESO = 27000;
const CUSTO_TRUCK = 6.50;
const CUSTO_CARRETA = 9.00;
const PCT_FRACIONADO_PADRAO = 0.04; 

const CDS_FOTUS = [
    { key: "viana", nome: "CD Viana - ES", coords: [-40.3842, -20.3708] },
    { key: "itupeva", nome: "CD Itupeva - SP", coords: [-47.0357, -23.1633] },
    { key: "goiania", nome: "CD Goiânia - GO", coords: [-49.2315, -16.8373] },
    { key: "guaramirim", nome: "CD Guaramirim - SC", coords: [-48.9934, -26.4735] },
    { key: "ananindeua", nome: "CD Ananindeua - PA", coords: [-48.4069, -1.3756] },
    { key: "cabo", nome: "CD Cabo - PE", coords: [-35.0336, -8.3396] },
    { key: "feira", nome: "CD Feira - BA", coords: [-38.9667, -12.2667] }
];

let pedidosPorCD = {}; CDS_FOTUS.forEach(cd => pedidosPorCD[cd.key] = []);
let currentCD = "viana";
let rotasGeradas = [];
let markers = [];
let risksCache = [];
let transportadoresCache = [];
let currentRouteIndex = -1;

map.on('load', () => {
    map.resize();
    initDropdown();
    carregarRiscos();
    carregarTransportadores();
    carregarHistorico();
    carregarDashboard();
});

// --- NAVEGAÇÃO ABAS ---
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
        });
    });
});

function initDropdown() {
    const sel = document.getElementById('selectOrigem');
    CDS_FOTUS.forEach(cd => {
        const opt = document.createElement('option'); opt.value = cd.key; opt.innerText = cd.nome; sel.appendChild(opt);
        const el = document.createElement('div'); el.innerHTML = `<i class="fas fa-industry" style="font-size:24px; color:#f97316; text-shadow: 2px 2px 2px black;"></i>`;
        new mapboxgl.Marker(el).setLngLat(cd.coords).setPopup(new mapboxgl.Popup().setHTML(`<b>${cd.nome}</b>`)).addTo(map);
    });
    sel.addEventListener('change', () => {
        currentCD = sel.value; voltarInput(); atualizarListaPedidos();
        const cd = CDS_FOTUS.find(c => c.key === currentCD);
        if(cd) map.flyTo({center: cd.coords, zoom: 8});
    });
}

function addPedidoManual() {
    const end = document.getElementById('inEnd').value; if(!end) return alert("Endereço obrigatório!");
    const p = { ID: "MANUAL", ENDERECO: end, PESO: parseFloat(document.getElementById('inPeso').value)||0, VALOR: parseFloat(document.getElementById('inValor').value)||0, CUBAGEM: parseFloat(document.getElementById('inVol').value)||0, DESCARGA: "Sem Auxílio" };
    pedidosPorCD[currentCD].push(p); document.getElementById('inEnd').value = ""; atualizarListaPedidos();
}
function removerPedido(idx) { pedidosPorCD[currentCD].splice(idx, 1); atualizarListaPedidos(); }
function atualizarListaPedidos() {
    const lista = document.getElementById('listaPedidos'); lista.innerHTML = ""; let totalPeso = 0;
    pedidosPorCD[currentCD].forEach((p, i) => {
        totalPeso += p.PESO;
        lista.innerHTML += `<div class="order-item"><div class="text-truncate" style="max-width:200px;"><strong>#${p.ID}</strong> ${p.ENDERECO}</div><div><span class="badge bg-secondary me-2">${p.PESO}kg</span><i class="fas fa-trash-alt btn-del" onclick="removerPedido(${i})"></i></div></div>`;
    });
    document.getElementById('lblQtd').innerText = pedidosPorCD[currentCD].length;
    document.getElementById('lblPeso').innerText = totalPeso.toLocaleString('pt-BR') + " kg";
    const v = totalPeso <= 12000 ? "Truck" : (totalPeso <= 27000 ? "Carreta" : "Excedente");
    const cor = totalPeso > 27000 ? "bg-danger" : "bg-warning text-dark";
    const lbl = document.getElementById('lblVeiculo'); lbl.innerText = v; lbl.className = `badge ${cor}`;
}

function handleFileUpload(input) {
    const file = input.files[0]; if (!file) return;
    showLoading(true, "Lendo Excel...");
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);
        let count = 0;
        const getVal = (row, keys) => { const rowKeys = Object.keys(row); for (let k of keys) { const found = rowKeys.find(rk => rk.toUpperCase().trim() === k.toUpperCase().trim() || rk.toUpperCase().includes(k.toUpperCase())); if(found) return row[found]; } return null; };
        json.forEach(row => {
            const cidade = getVal(row, ['CIDADE', 'Cidade Destino', 'City']);
            const uf = getVal(row, ['UF', 'UF Destino', 'State']);
            let end = getVal(row, ['ENDERECO', 'Endereço', 'Logradouro']);
            if (!end && cidade && uf) end = `${cidade} - ${uf}`;
            if(end) {
                pedidosPorCD[currentCD].push({
                    ID: getVal(row, ['NRO FOTUS', 'Nro. Fotus', 'PEDIDO']) || "IMP", ENDERECO: end,
                    PESO: parseFloat(getVal(row, ['PESO', 'Peso Bruto']) || 0), VALOR: parseFloat(getVal(row, ['VALOR', 'Valor Nota']) || 0),
                    CUBAGEM: parseFloat(getVal(row, ['CUBAGEM', 'Volume']) || 0), DESCARGA: getVal(row, ['Auxílio Descarga']) || "Não informado", UF: uf || ""
                });
                count++;
            }
        });
        showLoading(false); if (count === 0) alert("Nenhum pedido encontrado!"); else { atualizarListaPedidos(); alert(`${count} pedidos importados!`); }
    };
    reader.readAsArrayBuffer(file);
}

// --- ROTEIRIZAÇÃO ---
async function processarRota() {
    const pedidos = pedidosPorCD[currentCD]; if(pedidos.length === 0) return alert("Adicione pedidos!");
    showLoading(true, "Geocodificando...");
    for (let p of pedidos) {
        if (!p.lat) {
            try {
                const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(p.ENDERECO + ", Brasil")}.json?access_token=${MAPBOX_KEY}&limit=1`);
                const data = await res.json();
                if(data.features?.length) {
                    p.lon = data.features[0].center[0]; p.lat = data.features[0].center[1];
                    if(!p.UF) { const ctx = data.features[0].context; if(ctx) { const reg = ctx.find(c=>c.id.includes('region')); if(reg) p.UF = reg.short_code.replace('BR-', ''); } }
                }
            } catch(e) {}
        }
    }
    const validos = pedidos.filter(p => p.lat); if(validos.length === 0) { showLoading(false); return alert("Sem endereços válidos!"); }
    const rotasFinais = []; const cd = CDS_FOTUS.find(c => c.key === currentCD);
    let pendentes = [...validos]; let pontoAtual = { lat: cd.coords[1], lon: cd.coords[0] };
    let rotaAtual = []; let pesoAtual = 0; let valorAtual = 0;
    while(pendentes.length > 0) {
        let melhorIdx = -1; let menorDist = Infinity;
        pendentes.forEach((p, idx) => {
            const dist = turf.distance([pontoAtual.lon, pontoAtual.lat], [p.lon, p.lat]);
            if(dist < menorDist) { menorDist = dist; melhorIdx = idx; }
        });
        const cand = pendentes[melhorIdx];
        if (pesoAtual + cand.PESO > LIMIT_PESO && rotaAtual.length > 0) {
            fecharRota(rotasFinais, rotaAtual, pesoAtual, valorAtual, cd, "Peso");
            rotaAtual = []; pesoAtual = 0; valorAtual = 0; pontoAtual = { lat: cd.coords[1], lon: cd.coords[0] };
        } else {
            rotaAtual.push(cand); pesoAtual += cand.PESO; valorAtual += cand.VALOR; pontoAtual = cand; pendentes.splice(melhorIdx, 1);
        }
    }
    if(rotaAtual.length > 0) fecharRota(rotasFinais, rotaAtual, pesoAtual, valorAtual, cd, "Final");
    rotasGeradas = rotasFinais; showLoading(false); mostrarResultados();
}

function fecharRota(lista, pedidos, peso, valor, origem, motivo) {
    const veiculo = peso <= 12000 ? "Truck" : "Carreta";
    const custoKm = peso <= 12000 ? CUSTO_TRUCK : CUSTO_CARRETA;
    lista.push({
        rota_nome: `Rota ${currentCD.toUpperCase()} #${lista.length+1} (${new Date().toLocaleDateString()})`,
        pedidos: [...pedidos], peso_total: peso, valor_total: valor,
        veiculo: veiculo, custo_km_base: custoKm,
        origem: origem, motivo_quebra: motivo
    });
}

// --- CÁLCULO DE FRETE FRACIONADO (TABELA COMPLETA) ---
function calcularMelhorFracionado(rota) {
    const uf = rota.pedidos[0]?.UF;
    
    // Se não tem UF ou transportadores, usa padrão 4%
    if (!uf || !transportadoresCache.length) {
        return { valor: rota.valor_total * PCT_FRACIONADO_PADRAO, nome: "Tabela Padrão (4%)" };
    }

    let melhorPreco = Infinity;
    let melhorTransp = "Tabela Padrão (4%)";
    let encontrou = false;

    transportadoresCache.forEach(t => {
        // Verifica se atende a UF
        if (t.ufs_atendidas && t.ufs_atendidas.toUpperCase().includes(uf.toUpperCase())) {
            
            // Parâmetros da Tabela
            const adValorem = t.ad_valorem ? (t.ad_valorem / 100) : 0;
            const gris = t.gris ? (t.gris / 100) : 0;
            const tarifaKg = t.preco_kg || 0;
            const taxaFixa = t.taxa_fixa || 0;
            const minimo = t.frete_minimo || 0;
            const pedagio = t.pedagio || 0; // R$ por 100kg

            // Componentes do Frete
            const custoValor = rota.valor_total * adValorem;
            const custoGris = rota.valor_total * gris;
            const custoPeso = rota.peso_total * tarifaKg;
            const custoPedagio = (rota.peso_total / 100) * pedagio; // Ex: R$ 2,50 a cada 100kg
            
            let calculoTotal = custoValor + custoGris + custoPeso + custoPedagio + taxaFixa;
            
            // Aplica mínimo
            if (calculoTotal < minimo) calculoTotal = minimo;

            if (calculoTotal < melhorPreco) {
                melhorPreco = calculoTotal;
                melhorTransp = t.nome;
                encontrou = true;
            }
        }
    });

    if (encontrou) {
        return { valor: melhorPreco, nome: melhorTransp };
    } else {
        return { valor: rota.valor_total * PCT_FRACIONADO_PADRAO, nome: `Sem transp. p/ ${uf} (4%)` };
    }
}

// --- MOSTRAR RESULTADOS ---
function mostrarResultados() {
    document.getElementById('inputSection').style.display='none'; document.getElementById('resultSection').style.display='block';
    const container = document.getElementById('cardsContainer'); container.innerHTML = "";
    
    rotasGeradas.forEach((r, idx) => {
        // 1. Calcula o Melhor Fracionado (Automático)
        const resultadoFrac = calcularMelhorFracionado(r);
        r.frete_manual_fra = resultadoFrac.valor; // Armazena o valor calculado
        r.transportadora_sugerida = resultadoFrac.nome;

        // --- BARRA DE PESO ---
        let weightPct = (r.peso_total / LIMIT_PESO) * 100;
        if(weightPct > 100) weightPct = 100;
        let barColorClass = 'bg-success'; 
        if(weightPct > 70) barColorClass = 'bg-warning';
        if(weightPct > 92) barColorClass = 'bg-danger';

        const progressBarHTML = `
        <div class="weight-progress-container">
            <div class="progress-track"><div class="progress-fill ${barColorClass}" style="width: ${weightPct.toFixed(1)}%;"></div></div>
            <div class="progress-labels"><span>${r.peso_total.toLocaleString('pt-BR')} kg</span><span>Capacidade: ${LIMIT_PESO.toLocaleString('pt-BR')} kg</span></div>
        </div>`;

        container.innerHTML += `
        <div class="route-card" onclick="verRotaNoMapa(${idx})">
            <div class="d-flex justify-content-between"><h6 class="text-primary fw-bold mb-0">${r.rota_nome}</h6><span class="badge bg-dark">${r.veiculo}</span></div>
            <small class="text-muted">${r.pedidos.length} peds • ${(r.peso_total/1000).toFixed(1)} ton</small>
            ${progressBarHTML}
            
            <div class="mt-2 pt-2 border-top small text-success fw-bold">
                <i class="fas fa-award"></i> Melhor Fracionado: ${resultadoFrac.nome}
            </div>

            <div class="freight-inputs-container" onclick="event.stopPropagation()">
                <div class="freight-input-group"><label>Itinerante:</label><input type="number" class="freight-input" id="inIti_${idx}" onchange="recalc(${idx})"></div>
                <div class="freight-input-group"><label>Fracionado:</label><input type="number" class="freight-input" id="inFra_${idx}" value="${resultadoFrac.valor.toFixed(2)}" onchange="recalc(${idx})"></div>
            </div>
            <div class="route-actions">
                <button class="btn-action-icon text-success" onclick="abrirGoogleMaps(${idx}); event.stopPropagation()"><i class="fas fa-map-marked-alt"></i></button>
                <button class="btn-action-icon text-dark" onclick="gerarPDF(${idx}); event.stopPropagation()"><i class="fas fa-file-pdf"></i></button>
                <button class="btn-action-icon text-primary" onclick="salvarRotaFirestore(${idx}); event.stopPropagation()"><i class="fas fa-save"></i></button>
            </div>
        </div>`;
    });
    if(rotasGeradas.length > 0) verRotaNoMapa(0);
}

async function verRotaNoMapa(idx) {
    limparMapa(); currentRouteIndex = idx; const rota = rotasGeradas[idx];
    const coords = [rota.origem.coords];
    new mapboxgl.Marker({color:'red'}).setLngLat(rota.origem.coords).addTo(map);
    rota.pedidos.forEach((p, i) => {
        const el = document.createElement('div'); el.style.cssText = "background:#0d6efd; color:white; width:24px; height:24px; border-radius:50%; text-align:center; font-weight:bold; border:2px solid white;"; el.innerText = i+1;
        let btnMover = "";
        let melhorCD = null; let menorDist = Infinity;
        CDS_FOTUS.forEach(cd => { if(cd.key !== currentCD) { const d = turf.distance([p.lon, p.lat], cd.coords); if(d < menorDist) { menorDist = d; melhorCD = cd; } } });
        if(melhorCD) btnMover = `<button class="btn btn-sm btn-warning w-100 mt-1" onclick="window.moverParaOutroCD('${melhorCD.key}', ${idx}, ${i})">Mover p/ ${melhorCD.nome}</button>`;
        const popupHTML = `<div class="text-center"><b>${p.ID}</b><br>${p.ENDERECO}<br><span class="badge bg-secondary">${p.PESO}kg</span><hr class="my-1"><button class="btn btn-sm btn-danger w-100" onclick="window.removerPedidoDaRota(${idx}, ${i})">Remover</button>${btnMover}</div>`;
        new mapboxgl.Marker(el).setLngLat([p.lon, p.lat]).setPopup(new mapboxgl.Popup().setHTML(popupHTML)).addTo(map);
        markers.push(el); coords.push([p.lon, p.lat]);
    });
    if(coords.length > 1) {
        const waypoints = coords.map(c => c.join(',')).join(';');
        const exclude = document.getElementById('flagPedagio').checked ? '&exclude=toll' : '';
        try {
            const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?geometries=geojson&access_token=${MAPBOX_KEY}${exclude}`);
            const data = await res.json();
            const geo = data.routes[0].geometry;
            const distKm = data.routes[0].distance / 1000;
            const durMin = data.routes[0].duration / 60;
            
            let custoRisco = 0; let nomesRisco = [];
            const line = turf.lineString(geo.coordinates);
            risksCache.forEach(r => {
                if(r.lat && r.lon) {
                    const circle = turf.circle([r.lon, r.lat], r.raio/1000);
                    if(turf.booleanIntersects(line, circle)) { custoRisco += (parseFloat(r.custo_extra)||0); nomesRisco.push(r.descricao); }
                }
            });
            
            document.getElementById('routeStats').style.display='block';
            document.getElementById('financePanel').style.display='flex';
            document.getElementById('statNome').innerText = rota.rota_nome;
            document.getElementById('statDist').innerText = distKm.toFixed(1) + " km";
            document.getElementById('statVeiculo').innerText = rota.veiculo; 
            document.getElementById('statTempoTotal').innerText = `${Math.floor(durMin/60)}h ${Math.floor(durMin%60)}m`;
            
            const alertBox = document.getElementById('riskAlertBox');
            if(custoRisco > 0) { alertBox.style.display='block'; alertBox.innerHTML = `⚠️ Risco: ${nomesRisco.join(', ')} (+R$ ${custoRisco})`; } 
            else { alertBox.style.display='none'; }
            
            rota.custo_calculado = (distKm * rota.custo_km_base) + custoRisco;
            const inIti = document.getElementById(`inIti_${idx}`);
            if(!inIti.value) inIti.value = rota.custo_calculado.toFixed(2);
            recalc(idx);
            
            map.addLayer({id:'route', type:'line', source:{type:'geojson', data:{type:'Feature', geometry:geo}}, paint:{'line-color':'#0d6efd', 'line-width':4}});
            const b = new mapboxgl.LngLatBounds(); coords.forEach(c=>b.extend(c)); map.fitBounds(b, {padding:50});
        } catch(e){}
    }
}

function recalc(idx) {
    const r = rotasGeradas[idx];
    const valIti = parseFloat(document.getElementById(`inIti_${idx}`).value) || 0;
    const valFra = parseFloat(document.getElementById(`inFra_${idx}`).value) || 0;
    
    const pctIti = r.valor_total > 0 ? (valIti / r.valor_total) * 100 : 0;
    const pctFra = r.valor_total > 0 ? (valFra / r.valor_total) * 100 : 0;

    document.getElementById('valItinerante').innerText = valIti.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
    document.getElementById('pctItinerante').innerText = pctIti.toFixed(2) + "%";
    document.getElementById('valFracionado').innerText = valFra.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
    document.getElementById('pctFracionado').innerText = pctFra.toFixed(2) + "%";
    
    const cardI = document.getElementById('cardItinerante');
    const cardF = document.getElementById('cardFracionado');
    cardI.className = "finance-card"; cardF.className = "finance-card";
    document.getElementById('econItinerante').innerText = ""; document.getElementById('econFracionado').innerText = "";

    if(valIti < valFra) {
        cardI.classList.add('winner');
        document.getElementById('econItinerante').innerText = "Economia: " + (valFra - valIti).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
    } else {
        cardF.classList.add('winner');
        document.getElementById('econFracionado').innerText = "Economia: " + (valIti - valFra).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
    }
    r.frete_manual_iti = valIti; r.frete_manual_fra = valFra;
}

window.removerPedidoDaRota = function(rIdx, pIdx) {
    if(!confirm("Remover?")) return;
    rotasGeradas[rIdx].pedidos.splice(pIdx, 1);
    const p = rotasGeradas[rIdx].pedidos;
    rotasGeradas[rIdx].peso_total = p.reduce((s,i)=>s+i.PESO,0);
    rotasGeradas[rIdx].valor_total = p.reduce((s,i)=>s+i.VALOR,0);
    mostrarResultados(); verRotaNoMapa(rIdx);
};
window.moverParaOutroCD = function(targetKey, rIdx, pIdx) {
    if(!confirm(`Mover para ${targetKey}?`)) return;
    const p = rotasGeradas[rIdx].pedidos[pIdx];
    pedidosPorCD[targetKey].push(p);
    window.removerPedidoDaRota(rIdx, pIdx);
    alert("Movido com sucesso! Troque a origem para ver.");
};

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

function gerarPDF(idx) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF(); const r = rotasGeradas[idx];
    doc.setFontSize(18); doc.text("MANIFESTO DE CARGA", 14, 20); doc.setFontSize(10);
    doc.text(`Rota: ${r.rota_nome}`, 14, 30); doc.text(`Veículo: ${r.veiculo} | Data: ${new Date().toLocaleDateString()}`, 14, 35);
    const rows = r.pedidos.map((p, i) => [i+1, p.ID, p.ENDERECO, `${p.PESO} kg`, `R$ ${p.VALOR.toLocaleString('pt-BR')}`]);
    doc.autoTable({ startY: 40, head: [['Seq', 'Pedido', 'Endereço', 'Peso', 'Valor']], body: rows });
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.text(`Peso Total: ${r.peso_total} kg`, 14, finalY); doc.text(`Valor Total: R$ ${r.valor_total.toLocaleString('pt-BR')}`, 14, finalY+7);
    doc.text(`Frete: R$ ${(r.frete_manual_iti||0).toLocaleString('pt-BR')}`, 14, finalY+14); doc.save(`Manifesto_${r.rota_nome}.pdf`);
}

function salvarRotaFirestore(idx) {
    const r = rotasGeradas[idx];
    const obj = {
        nome_rota: r.rota_nome, veiculo: r.veiculo, total_km: r.total_km || 0,
        valor_frete: r.frete_manual_iti, data_criacao: new Date().toISOString(),
        dados_json: JSON.stringify({ pedidos: r.pedidos, origem: r.origem, peso_total: r.peso_total, valor_total: r.valor_total, frete_manual_iti: r.frete_manual_iti, frete_manual_fra: r.frete_manual_fra, veiculo: r.veiculo, transp_sugerido: r.transportadora_sugerida }),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection("historico").add(obj).then(() => alert("Salvo!"));
}

function carregarHistorico() {
    const div = document.getElementById('historyList'); div.innerHTML = "Carregando...";
    db.collection("historico").orderBy("data_criacao", "desc").limit(20).get().then(q => {
        div.innerHTML = "";
        q.forEach(doc => {
            const d = doc.data(); const dt = d.data_criacao ? new Date(d.data_criacao).toLocaleDateString() : "-";
            div.innerHTML += `<div class="history-item p-2 mb-1 border rounded d-flex justify-content-between"><div onclick='restaurarRota(${d.dados_json})'><strong>${d.nome_rota}</strong><br><small>${dt} • ${d.veiculo}</small></div><i class="fas fa-trash text-danger" onclick="delDoc('historico','${doc.id}')"></i></div>`;
        });
    });
}
function restaurarRota(json) { rotasGeradas = [typeof json === 'string' ? JSON.parse(json) : json]; document.querySelector('#home-tab').click(); mostrarResultados(); }
function delDoc(col, id) { if(confirm("Apagar?")) db.collection(col).doc(id).delete().then(() => { if(col==='historico') carregarHistorico(); if(col==='riscos') carregarRiscos(); if(col==='transportadores') carregarTransportadores(); }); }
async function salvarRisco() {
    const addr = document.getElementById('riskAddr').value; if(!addr) return;
    try { const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${MAPBOX_KEY}&limit=1`); const d = await res.json();
    if(d.features?.length) db.collection("areas_risco").add({ descricao: document.getElementById('riskDesc').value, custo_extra: parseFloat(document.getElementById('riskCost').value), raio: parseInt(document.getElementById('riskRadius').value), lat: d.features[0].center[1], lon: d.features[0].center[0] }).then(()=>{alert("Salvo!"); carregarRiscos();});
    } catch(e){}
}
function carregarRiscos() { db.collection("areas_risco").get().then(q => { risksCache = []; const div = document.getElementById('listaRiscos'); div.innerHTML=""; q.forEach(doc=>{ const d=doc.data(); risksCache.push(d); div.innerHTML+=`<div class="d-flex justify-content-between border-bottom p-1"><span>${d.descricao}</span><i class="fas fa-trash text-danger" onclick="delDoc('areas_risco','${doc.id}')"></i></div>`; }); }); }

// --- FUNÇÃO DE SALVAR TRANSPORTADORA (ATUALIZADA COM NOVOS CAMPOS) ---
function salvarTransportadora() {
    const nome = document.getElementById('transpNome').value;
    if(!nome) return alert("Nome obrigatório");

    const data = {
        nome: nome,
        ufs_atendidas: document.getElementById('transpUfs').value.toUpperCase(),
        ad_valorem: parseFloat(document.getElementById('transpAdValorem').value) || 0,
        gris: parseFloat(document.getElementById('transpGris').value) || 0,
        preco_kg: parseFloat(document.getElementById('transpPrecoKg').value) || 0,
        taxa_fixa: parseFloat(document.getElementById('transpTaxa').value) || 0,
        frete_minimo: parseFloat(document.getElementById('transpMinimo').value) || 0,
        pedagio: parseFloat(document.getElementById('transpPedagio').value) || 0
    };

    db.collection("transportadores").add(data).then(() => {
        alert("Tabela Salva com Sucesso!");
        carregarTransportadores();
        // Limpar campos
        document.getElementById('transpNome').value = '';
        document.getElementById('transpUfs').value = '';
        document.getElementById('transpAdValorem').value = '';
        document.getElementById('transpGris').value = '';
        document.getElementById('transpPrecoKg').value = '';
        document.getElementById('transpTaxa').value = '';
        document.getElementById('transpMinimo').value = '';
        document.getElementById('transpPedagio').value = '';
    });
}

function carregarTransportadores() { 
    db.collection("transportadores").get().then(q => { 
        transportadoresCache = []; 
        const div = document.getElementById('listaTransportadores'); div.innerHTML=""; 
        q.forEach(doc=>{ 
            const d=doc.data(); transportadoresCache.push(d); 
            div.innerHTML+=`
            <div class="d-flex justify-content-between border-bottom p-2 align-items-center">
                <div>
                    <strong>${d.nome}</strong> <span class="badge bg-light text-dark">${d.ufs_atendidas}</span><br>
                    <small class="text-muted">Min: R$${d.frete_minimo} • Kg: R$${d.preco_kg} • AdV: ${d.ad_valorem}%</small>
                </div>
                <i class="fas fa-trash text-danger" style="cursor:pointer" onclick="delDoc('transportadores','${doc.id}')"></i>
            </div>`; 
        }); 
    }); 
}

// --- FUNÇÃO DE IMPORTAR TABELA (TURBO - SUPORTA MILHARES DE LINHAS) ---
// --- FUNÇÃO DE IMPORTAR TABELA (VARREDURA MULTI-ABAS) ---
async function importarTabelaTransp(input) {
    const file = input.files[0];
    if (!file) return;
    
    showLoading(true, "Procurando tabela de preços...");
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        
        let targetSheet = null;
        let headerRowIndex = 0;

        // 1. VARREDURA INTELIGENTE: Procura a aba certa
        // Percorre todas as abas para achar qual tem dados de frete
        for (let sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            // Procura a linha de cabeçalho nesta aba
            const rowIndex = rows.findIndex(row => 
                row && row.some(cell => cell && (
                    cell.toString().toUpperCase().includes('NOTA MAIOR LIMITANTE') || 
                    cell.toString().toUpperCase().includes('ADVALOREM') ||
                    cell.toString().toUpperCase().includes('FRETE VALOR') ||
                    cell.toString().toUpperCase().includes('FRETE PESO')
                ))
            );

            if (rowIndex !== -1) {
                console.log(`Tabela encontrada na aba: ${sheetName}`);
                targetSheet = sheet;
                headerRowIndex = rowIndex;
                break; // Achou! Para de procurar.
            }
        }

        if (!targetSheet) {
            // Se não achou pelos nomes difíceis, tenta achar pelo básico "UF" e "MINIMO"
            for (let sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                const rowIndex = rows.findIndex(row => 
                    row && row.some(cell => cell && (
                        cell.toString().toUpperCase().trim() === 'UF' || 
                        cell.toString().toUpperCase().includes('REGIAO')
                    ))
                );
                if (rowIndex !== -1) {
                    targetSheet = sheet;
                    headerRowIndex = rowIndex;
                    break;
                }
            }
        }

        if (!targetSheet) {
            showLoading(false);
            return alert("Não encontramos uma Tabela de Preços válida em nenhuma aba do arquivo.");
        }

        // 2. PROCESSAMENTO (A partir da aba e linha encontradas)
        const json = XLSX.utils.sheet_to_json(targetSheet, { range: headerRowIndex, defval: "" });
        
        const cleanNum = (val) => {
            if (!val) return 0;
            if (typeof val === 'number') return val;
            let s = val.toString().toUpperCase().replace("R$", "").replace("%", "").trim();
            if (s.includes(",") && !s.includes(".")) s = s.replace(/\./g, "").replace(",", "."); 
            else if (s.includes(",") && s.includes(".")) s = s.replace(".", "").replace(",", ".");
            return parseFloat(s) || 0;
        };

        const getVal = (row, keys) => {
            const rowKeys = Object.keys(row);
            for (let k of keys) {
                const found = rowKeys.find(rk => 
                    rk.toUpperCase().trim() === k || 
                    rk.toUpperCase().includes(k)
                );
                if(found) return row[found];
            }
            return "";
        };

        let totalImportado = 0;
        const BATCH_SIZE = 400;
        
        for (let i = 0; i < json.length; i += BATCH_SIZE) {
            const chunk = json.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            let opsNoBatch = 0;

            chunk.forEach(row => {
                let uf = getVal(row, ['UF', 'ESTADO', 'DESTINO', 'REGIAO']);
                if (uf && uf.length > 2) {
                    const match = uf.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/);
                    if (match) uf = match[0];
                }

                // Tenta pegar nome de colunas ou usa o nome do arquivo
                let nome = getVal(row, ['NOME', 'TRANSPORTADORA', 'PARCEIRO', 'EMPRESA']);
                if (!nome) nome = file.name.replace(".xlsx", "").replace(".xls", "").replace(".csv", "");

                if (uf) {
                    const docRef = db.collection("transportadores").doc();
                    const obj = {
                        nome: nome,
                        ufs_atendidas: uf.toString().toUpperCase().trim(),
                        ad_valorem: cleanNum(getVal(row, ['NOTA MAIOR LIMITANTE', 'ADVALOREM', 'AD_VALOREM', 'ADV', 'FRETE VALOR'])),
                        preco_kg: cleanNum(getVal(row, ['FRETE TONELADA', 'PRECO_KG', 'R$/KG', 'TAR_PESO', 'FRETE PESO'])),
                        frete_minimo: cleanNum(getVal(row, ['FRETE VALOR MINIMO', 'MINIMO', 'VALOR MINIMO'])),
                        gris: cleanNum(getVal(row, ['GRIS', 'RISCO'])),
                        taxa_fixa: cleanNum(getVal(row, ['TAXA', 'TDE', 'DESPACHO', 'CAT', 'TAS'])),
                        pedagio: cleanNum(getVal(row, ['PEDAGIO', 'PED']))
                    };
                    batch.set(docRef, obj);
                    opsNoBatch++;
                }
            });

            if (opsNoBatch > 0) {
                await batch.commit();
                totalImportado += opsNoBatch;
                document.getElementById('loading-text').innerText = `Importando... (${totalImportado})`;
            }
        }

        showLoading(false);
        if (totalImportado > 0) {
            alert(`Sucesso! ${totalImportado} regras importadas da aba correta.`);
            carregarTransportadores();
        } else {
            alert("Aba encontrada, mas sem dados válidos de UF.");
        }
    };
    reader.readAsArrayBuffer(file);
}

function abrirGoogleMaps(idx) { const r = rotasGeradas[idx]; const o = `${r.origem.coords[1]},${r.origem.coords[0]}`; const d = r.pedidos.map(p => `${p.lat},${p.lon}`).join('/'); window.open(`https://www.google.com/maps/dir/${o}/${d}`, '_blank'); }
function voltarInput() { document.getElementById('resultSection').style.display='none'; document.getElementById('inputSection').style.display='block'; limparMapa(); }
function limparMapa() { markers.forEach(m => m.remove()); markers = []; if(map.getLayer('route')) { map.removeLayer('route'); map.removeSource('route'); } document.getElementById('financePanel').style.display='none'; document.getElementById('routeStats').style.display='none'; }
function showLoading(show, txt) { document.getElementById('loading').style.display = show ? 'block' : 'none'; if(txt) document.getElementById('loading-text').innerText = txt; }
function carregarDashboard() {}