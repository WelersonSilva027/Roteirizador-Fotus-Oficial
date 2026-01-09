/**
 * ============================================================================
 * ROTEIRIZADOR FOTUS LOGÍSTICA - DOCUMENTAÇÃO E FORMATAÇÃO
 * ============================================================================
 */


// ==============================================================
//          1. CONFIGURAÇÕES GERAIS E INICIALIZAÇÃO
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

// Inicializa Firebase se ainda não existir instância
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth(); // Adicionado Auth

// Inicializa Mapbox
mapboxgl.accessToken = MAPBOX_KEY;
const map = new mapboxgl.Map({ 
    container: 'map', 
    style: 'mapbox://styles/mapbox/streets-v12', 
    center: [-40.3842, -20.3708], 
    zoom: 5 
});

let kpiChartInstance = null;

// ==============================================================
//              2. VARIÁVEIS GLOBAIS E CONSTANTES
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
let tempImportFile = null; // Variável para segurar o arquivo durante a decisão do modal

// Constantes de Regra de Negócio
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

// Inicializa arrays vazios para cada CD
CDS_FOTUS.forEach(cd => pedidosPorCD[cd.key] = []);

// ==============================================================
//          3. CICLO DE VIDA E LOGIN (FIREBASE AUTH)
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

/**
 * Verifica o estado de autenticação do usuário e carrega permissões.
 */
function verificarAutenticacao() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            const cdSalvo = localStorage.getItem('fotus_user_cd') || "CD Viana - ES";
            
            // Valores Padrão
            let dadosUser = { 
                role: "VISITANTE", 
                perm_excluir: false, 
                perm_editar: false, 
                perm_financeiro: false 
            };

            try {
                const userDoc = await db.collection("users").doc(user.uid).get();
                if (userDoc.exists) {
                    const d = userDoc.data();
                    dadosUser.role = d.role || "VISITANTE";
                    // Se for Master, força tudo true. Se não, lê do banco.
                    const isMaster = (dadosUser.role === 'MASTER');
                    dadosUser.perm_excluir = isMaster ? true : (d.perm_excluir || false);
                    dadosUser.perm_editar = isMaster ? true : (d.perm_editar || false);
                    dadosUser.perm_financeiro = isMaster ? true : (d.perm_financeiro || false);
                    
                    db.collection("users").doc(user.uid).update({ last_login: new Date().toISOString(), email: user.email });
                } else {
                    await db.collection("users").doc(user.uid).set({
                        email: user.email, role: "VISITANTE", created_at: new Date().toISOString()
                    });
                }
            } catch(e) { console.error(e); }

            currentUser = {
                nome: user.email.split('@')[0].toUpperCase(),
                cd: cdSalvo,
                email: user.email,
                uid: user.uid,
                role: dadosUser.role,
                perm_excluir: dadosUser.perm_excluir,
                perm_editar: dadosUser.perm_editar,
                perm_financeiro: dadosUser.perm_financeiro
            };

            document.getElementById('displayUser').innerText = currentUser.nome;
            document.getElementById('displayFilial').innerText = currentUser.cd;
            
            const badge = document.getElementById('displayRole');
            if(badge) {
                badge.innerText = currentUser.role;
                badge.className = `badge ${currentUser.role === 'MASTER' ? 'bg-danger' : (currentUser.role === 'OPERADOR' ? 'bg-primary' : 'bg-secondary')}`;
            }

            // Exibe aba Usuários (Só Master)
            const abaUsers = document.getElementById('navItemUsers');
            if(abaUsers) abaUsers.style.display = (currentUser.role === 'MASTER') ? 'block' : 'none';

            // Aplica bloqueios visuais
            aplicarRegrasDeNegocio();

            const sel = document.getElementById('selectOrigem');
            if(sel) sel.value = currentUser.cd;
            currentCD = currentUser.cd;
            
            if(typeof atualizarContadorPendentes === 'function') atualizarContadorPendentes();

        }
    });
}

/**
 * Aplica as regras de negócio na interface baseadas no cargo (Role).
 */
function aplicarRegrasDeNegocio() {
    // Se não tiver role definida, assume visitante
    const role = (currentUser && currentUser.role) ? currentUser.role : "VISITANTE";
    
    // Mapeamento dos elementos da tela
    const el = {
        mainContent: document.getElementById('mainContent'),
        telaBloqueio: document.getElementById('telaBloqueio'),
        abas: {
            operacao: document.getElementById('li-operacao'),
            cotacoes: document.getElementById('li-cotacoes'),
            kpi: document.getElementById('li-kpi'),
            riscos: document.getElementById('li-riscos'),
            historico: document.getElementById('li-historico'),
            usuarios: document.getElementById('li-usuarios') 
        },
        navItemUsers: document.getElementById('navItemUsers') 
    };

    // 1. CENÁRIO VISITANTE: BLOQUEIA TUDO
    if (role === 'VISITANTE') {
        if (el.mainContent) el.mainContent.style.display = 'none';
        if (el.telaBloqueio) {
            el.telaBloqueio.style.display = 'block';
            const spanId = document.getElementById('myUid');
            if (spanId) spanId.innerText = currentUser.uid || '---';
        }
        // Esconde todas as abas por segurança
        if (el.navItemUsers) el.navItemUsers.style.display = 'none';
        return; 
    }

    // Se não for visitante, libera a tela
    if (el.mainContent) el.mainContent.style.display = 'block';
    if (el.telaBloqueio) el.telaBloqueio.style.display = 'none';

    // 2. REGRAS ESPECÍFICAS POR CARGO
    
    // Master: Vê tudo (Aba Usuários aparece)
    if (role === 'MASTER') {
        if (el.navItemUsers) el.navItemUsers.style.display = 'block';
    }
    
    // Operador: Vê tudo, MENOS usuários
    else if (role === 'OPERADOR') {
        if (el.navItemUsers) el.navItemUsers.style.display = 'none';
    }
    
    // Financeiro: Não vê Roteirização nem Usuários
    else if (role === 'FINANCEIRO') {
        if (el.navItemUsers) el.navItemUsers.style.display = 'none';
        if (el.abas.operacao) el.abas.operacao.style.display = 'none';
        
        // Redireciona para a aba de KPIs para não ficar na tela em branco
        const tabDash = document.querySelector('#dash-tab');
        if (tabDash) {
            const tabInstance = new bootstrap.Tab(tabDash);
            tabInstance.show();
        }
    }
}

function aplicarBloqueios(role) {
    const inputs = document.getElementById('inputSection');
    if(!inputs) return;
    
    if (role === 'FINANCEIRO' || role === 'VISITANTE') {
        inputs.style.pointerEvents = 'none';
        inputs.style.opacity = '0.5';
    } else {
        inputs.style.pointerEvents = 'auto';
        inputs.style.opacity = '1';
    }
}

window.logout = function() {
    if(confirm("Deseja realmente sair?")) {
        auth.signOut().then(() => {
            window.location.href = "../"; // Volta para o login
        });
    }
};

// Configuração das Abas (Tabs)
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
//                      4. GESTÃO DE COTAÇÕES
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

    // 1. Busca Target (Mantido)
    db.collection("historico").where("id_operacao", "==", idOp).get().then(snap => {
        if(!snap.empty) {
            const d = snap.docs[0].data();
            const target = d.target_price || 0;
            document.getElementById('quoteTarget').value = target > 0 ? target : ""; 
        }
    });
    
    // 2. Carrega e Renderiza Ofertas (VISUAL MELHORADO)
    const divLista = document.getElementById('listaOfertas');
    divLista.innerHTML = "<div class='text-center py-3 text-muted'><i class='fas fa-circle-notch fa-spin'></i> Buscando lances...</div>";
    
    db.collection("cotacoes")
        .where("id_operacao", "==", idOp)
        .onSnapshot(snapshot => {
            ofertasCache = [];
            divLista.innerHTML = "";
            let bestPrice = Infinity;
            
            if (snapshot.empty) {
                divLista.innerHTML = "<div class='text-center text-muted mt-3 py-4 border border-dashed rounded bg-light small'>Nenhuma oferta registrada.</div>";
                document.getElementById('quoteBest').innerText = "R$ 0,00";
                return;
            }

            let ofertasTemp = [];
            snapshot.forEach(doc => ofertasTemp.push({id: doc.id, ...doc.data()}));
            
            // Ordena: Menor preço primeiro
            ofertasTemp.sort((a, b) => a.valor_oferta - b.valor_oferta);

            // --- RENDERIZAÇÃO DOS CARDS ---
            ofertasTemp.forEach((d, index) => {
                if (d.valor_oferta < bestPrice) bestPrice = d.valor_oferta;
                
                // Lógica do Campeão (Top 1)
                const isWinner = (index === 0); // O primeiro da lista é o vencedor
                
                // Estilos Condicionais
                const bgStyle = isWinner ? "background-color: #d1e7dd;" : "background-color: #fff;"; // Verde claro se ganhar
                const borderClass = isWinner ? "border border-success" : "border";
                const trophyHtml = isWinner ? '<i class="fas fa-trophy text-success me-2" style="font-size:1.1rem;"></i>' : '';
                const nameClass = isWinner ? "text-dark" : "text-secondary";
                
                // Formatação de Data
                let dateStr = "--/--";
                if(d.timestamp) {
                    const dateObj = d.timestamp.toDate ? d.timestamp.toDate() : new Date(d.timestamp);
                    dateStr = dateObj.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) + ", " + dateObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
                }

                divLista.innerHTML += `
                <div class="card mb-2 shadow-sm ${borderClass}" style="${bgStyle} transition: all 0.3s;">
                    <div class="card-body p-2 d-flex justify-content-between align-items-center">
                        
                        <div style="flex: 1; overflow: hidden;">
                            <div class="d-flex align-items-center mb-1">
                                ${trophyHtml}
                                <strong class="${nameClass} text-truncate" style="font-size: 1rem;">${d.motorista}</strong>
                                <span class="badge bg-info text-dark ms-2 shadow-sm" style="font-size: 0.6em;">WEB</span>
                            </div>
                            
                            <div class="small text-uppercase text-secondary mb-1" style="font-size: 0.7rem; letter-spacing: 0.5px;">
                                <strong>${d.empresa || 'PARTICULAR'}</strong> • ${d.modalidade || 'PADRÃO'}
                            </div>

                            <div class="small text-muted fst-italic text-truncate">
                                <i class="far fa-comment-dots"></i> ${d.obs || 'Sem observações'}
                            </div>
                        </div>

                        <div class="text-end ms-2" style="min-width: 120px;">
                            <div class="h4 fw-bold text-success mb-0" style="letter-spacing: -0.5px;">
                                R$ ${d.valor_oferta.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                            </div>
                            <div class="small text-muted mb-1" style="font-size: 0.75rem;">
                                Prazo: ${d.prazo || '?'}
                            </div>
                            <div class="d-flex justify-content-end align-items-center gap-2">
                                <small class="text-muted" style="font-size: 0.65rem;">${dateStr}</small>
                                <i class="fas fa-trash text-danger cursor-pointer hover-scale" onclick="window.excluirOferta('${d.id}')" title="Excluir Oferta"></i>
                            </div>
                        </div>

                    </div>
                </div>`;
            });
            
            if(bestPrice !== Infinity) {
                document.getElementById('quoteBest').innerText = bestPrice.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            }
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

// Excluir Oferta
window.excluirOferta = function(docId) {
    if (!currentUser.perm_excluir) return alert("Sem permissão para excluir ofertas.");
    if(confirm("Excluir oferta?")) db.collection("cotacoes").doc(docId).delete();
};

// ==========================================================================
//          5. GESTÃO DE INPUTS E TELA PRINCIPAL (Funções "init" e "add")
// ==========================================================================

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

// Excluir Item da Lista
function removerPedido(idx) { 
    if (!currentUser.perm_excluir) return alert("Sem permissão para excluir.");
    pedidosPorCD[currentCD].splice(idx, 1); 
    todosPedidosBackup = [...pedidosPorCD[currentCD]];
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

// =================================================================================
//         MÓDULO 3: GESTÃO DE DADOS (IMPORTAÇÃO E LISTA) - REDUNDÂNCIA MANTIDA
// =================================================================================

// NOTA: Esta função 'initDropdown' é duplicada no código original. Mantida.
/*
function initDropdown() {
    const sel = document.getElementById('selectOrigem');
    if(!sel) return;
    
    sel.innerHTML = ""; 
    
    CDS_FOTUS.forEach(cd => {
        const opt = document.createElement('option'); opt.value = cd.nome; opt.innerText = cd.nome; sel.appendChild(opt);
        const el = document.createElement('div'); el.innerHTML = `<i class="fas fa-industry" style="font-size:24px; color:#f97316; text-shadow: 2px 2px 2px black;"></i>`;
        new mapboxgl.Marker(el).setLngLat(cd.coords).setPopup(new mapboxgl.Popup().setHTML(`<b>${cd.nome}</b>`)).addTo(map);
    });

    sel.addEventListener('change', () => {
        currentCD = sel.value; voltarInput(); atualizarListaPedidos();
        const cd = CDS_FOTUS.find(c => c.nome === currentCD);
        if(cd) map.flyTo({center: cd.coords, zoom: 8});
    });
}

// NOTA: Esta função 'addPedidoManual' é duplicada no código original. Mantida.
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
    
    if(!pedidosPorCD[currentCD]) pedidosPorCD[currentCD] = [];
    pedidosPorCD[currentCD].push(p); 
    todosPedidosBackup = [...pedidosPorCD[currentCD]];
    document.getElementById('inEnd').value = ""; 
    atualizarListaPedidos();
}

// NOTA: Esta função 'removerPedido' é duplicada no código original. Mantida.
function removerPedido(idx) { 
    // TRAVA DE SEGURANÇA: SÓ MASTER PODE EXCLUIR
    if (currentUser.role !== 'MASTER') {
        return alert("ACESSO NEGADO: Somente usuários MASTER podem remover itens.");
    }

    pedidosPorCD[currentCD].splice(idx, 1); 
    todosPedidosBackup = [...pedidosPorCD[currentCD]];
    atualizarListaPedidos(); 
}

// NOTA: Esta função 'atualizarListaPedidos' é duplicada no código original. Mantida.
function atualizarListaPedidos() {
    const lista = document.getElementById('listaPedidos'); lista.innerHTML = ""; 
    let totalPeso = 0; let totalValor = 0;
    const peds = pedidosPorCD[currentCD] || [];
    
    peds.forEach((p, i) => {
        totalPeso += p.PESO; totalValor += p.VALOR;
        lista.innerHTML += `
        <div class="order-item">
            <div class="text-truncate" style="max-width:200px;"><strong>#${p.ID}</strong> ${p.ENDERECO}</div>
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
    const lbl = document.getElementById('lblVeiculo'); lbl.innerText = v; lbl.className = `badge ${cor}`;
}
*/
// --- FUNÇÃO DE IMPORTAÇÃO COM MESCLAGEM (ATUALIZADA) ---

// 1. GATILHO INICIAL (Chamado pelo input type="file")
function handleFileUpload(input) {
    const file = input.files[0]; 
    if (!file) return;
    
    // Verifica se já existem pedidos na tela
    if (pedidosPorCD[currentCD] && pedidosPorCD[currentCD].length > 0) {
        // Se já tem pedidos, guarda o arquivo e abre o Modal para perguntar
        tempImportFile = file; 
        const elModal = document.getElementById('modalMesclar');
        if(elModal) {
            const modal = new bootstrap.Modal(elModal);
            modal.show();
        } else {
            // Fallback se o modal não existir no HTML
            if(confirm("Deseja MESCLAR com os pedidos existentes? Clique OK para JUNTAR ou CANCELAR para SUBSTITUIR.")) {
                processarArquivoImportado(file, true);
            } else {
                processarArquivoImportado(file, false);
            }
        }
        // Limpa o input para não travar se o usuário cancelar
        input.value = ""; 
    } else {
        // Se a lista está vazia, processa direto (Substituir/Novo)
        processarArquivoImportado(file, false);
        input.value = "";
    }
}

// 4. LÓGICA REAL DE PROCESSAMENTO DO EXCEL
function processarArquivoImportado(file, manterAtuais) {
    showLoading(true, "Lendo Pedidos...");
    const reader = new FileReader();
    
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            
            // Tenta localizar o cabeçalho automaticamente
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            let headerRowIndex = rows.findIndex(row => row && row.some(cell => cell && (cell.toString().toUpperCase().includes('NRO') || cell.toString().toUpperCase().includes('PEDIDO') || cell.toString().toUpperCase().includes('CIDADE'))));
            if (headerRowIndex === -1) headerRowIndex = 0;
            
            const json = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" });
            
            let count = 0;
            
            // LÓGICA DE MESCLAGEM:
            // Se "manterAtuais" for FALSO, limpamos a lista.
            // Se for VERDADEIRO, mantemos a lista como está e apenas adicionamos.
            if (!manterAtuais || !pedidosPorCD[currentCD]) {
                pedidosPorCD[currentCD] = [];
            }
            
            // Cria um Set de IDs existentes para evitar duplicar O MESMO PEDIDO se ele estiver na planilha E na tela
            const idsExistentes = new Set(pedidosPorCD[currentCD].map(p => String(p.ID).trim()));

            // Funções auxiliares de limpeza
            const cleanNum = (val) => { if (typeof val === 'number') return val; if (!val) return 0; let s = val.toString().replace("R$", "").replace("kg", "").trim(); if (s.includes(",") && !s.includes(".")) s = s.replace(/\./g, "").replace(",", "."); else if (s.includes(",") && s.includes(".")) s = s.replace(",", "."); return parseFloat(s) || 0; };
            const getVal = (row, keys) => { const rowKeys = Object.keys(row); for (let k of keys) { const found = rowKeys.find(rk => rk.toUpperCase().trim() === k.toUpperCase().trim() || rk.toUpperCase().includes(k.toUpperCase())); if(found) return row[found]; } return ""; };

            json.forEach(row => {
                const cidade = getVal(row, ['Cidade Destino', 'CIDADE', 'City']); 
                const uf = getVal(row, ['UF Destino', 'UF', 'State']); 
                let end = getVal(row, ['ENDERECO', 'Endereço', 'Logradouro']); 
                const idPedido = getVal(row, ['Nro. Fotus', 'NRO FOTUS', 'PEDIDO', 'Nro']) || "IMP";

                // Se estamos MESCLANDO e o pedido já existe na lista, ignoramos para não duplicar
                if (manterAtuais && idsExistentes.has(String(idPedido).trim())) {
                    return; 
                }

                if (!end && cidade && uf) end = `${cidade} - ${uf}`;
                
                if(end || (cidade && uf)) {
                    pedidosPorCD[currentCD].push({ 
                        ID: idPedido, 
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

            // ATUALIZA O BACKUP GLOBAL COM A NOVA LISTA (MESCLADA OU NOVA)
            todosPedidosBackup = [...pedidosPorCD[currentCD]]; 
            
            // Atualiza inputs visuais
            const inputQtd = document.getElementById('inputQtdLimite');
            if(inputQtd) inputQtd.placeholder = `Máx: ${pedidosPorCD[currentCD].length}`;
            
            showLoading(false); 
            
            if (count === 0 && !manterAtuais) {
                alert("Nenhum pedido novo importado."); 
            } else { 
                atualizarListaPedidos(); 
                
                // Mensagem de feedback inteligente
                let msg = manterAtuais 
                    ? `${count} novos pedidos adicionados à lista existente!\nTotal agora: ${pedidosPorCD[currentCD].length} pedidos.`
                    : `${count} pedidos importados com sucesso!`;
                
                alert(msg);
                
                // Tenta pintar o mapa automaticamente se a função existir
                if (typeof pintarMapaVisaoGeral === 'function' && document.getElementById('checkPintarMapa')?.checked) {
                    setTimeout(() => pintarMapaVisaoGeral(), 500);
                }
            }
        } catch(err) {
            showLoading(false);
            console.error(err);
            alert("Erro ao ler arquivo Excel: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

// 2. FUNÇÃO CHAMADA PELOS BOTÕES DO MODAL (HTML)
window.resolverImportacao = function(manterAtuais) {
    // Fecha o modal
    const elModal = document.getElementById('modalMesclar');
    const modal = bootstrap.Modal.getInstance(elModal);
    if(modal) modal.hide();
    
    // Processa o arquivo que estava guardado
    if(tempImportFile) {
        processarArquivoImportado(tempImportFile, manterAtuais);
        tempImportFile = null; // Limpa a memória
    }
};

// 3. CANCELAMENTO
window.cancelarImportacao = function() {
    tempImportFile = null;
    const input = document.getElementById('csvFile');
    if(input) input.value = "";
}

// ==============================================================
//                    6. MOTOR DE ROTEIRIZAÇÃO
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

// =======================================================================================
//     MÓDULO 5: VISUALIZAÇÃO E UI (CARDS, RESULTADOS, DESENHO ROTA) - COM BOTÃO SOBRAS
// =======================================================================================

// ATUALIZADO: COM CADEADO E BOTÃO MESCLAR
function mostrarResultados() {
    document.getElementById('inputSection').style.display='none'; 
    document.getElementById('resultSection').style.display='block';
    
    const container = document.getElementById('cardsContainer'); 
    container.innerHTML = "";
    
    rotasGeradas.forEach((r, idx) => {
        const resFrac = calcularMelhorFracionado(r);
        r.frete_manual_fra = resFrac.valor; r.transportadora_sugerida = resFrac.nome;
        
        let weightPct = (r.peso_total / LIMIT_PESO) * 100; if(weightPct > 100) weightPct = 100;
        const barColor = weightPct > 92 ? 'bg-danger' : (weightPct > 70 ? 'bg-warning' : 'bg-success');
        
        const nomeRota = r.rota_nome || `Rota #${idx+1}`;
        const isRestantes = nomeRota.toUpperCase().includes("RESTANTES");
        const cardStyle = isRestantes ? "border: 2px solid #ffc107; background-color: #fff3cd;" : "border-left: 5px solid #0d6efd;";
        const badgeColor = isRestantes ? "bg-warning text-dark" : "bg-dark";
        
        const isLocked = r.locked === true; // Verifica se está travada
        const lockIcon = isLocked ? '<i class="fas fa-lock text-danger"></i>' : '<i class="fas fa-lock-open text-muted"></i>';
        const lockClass = isLocked ? 'disabled-card' : '';
        const disabledAttr = isLocked ? 'disabled' : '';

        // Botões de Ação (Salvar, PDF, Maps)
        let btnSaveHtml = "";
        if (isRestantes) {
            btnSaveHtml = `<button class="btn btn-sm btn-warning text-dark border fw-bold" onclick="window.arquivarRotaRestante(${idx}); event.stopPropagation()"><i class="fas fa-inbox"></i> ARQUIVAR</button>`;
        } else {
            // Só mostra Mesclar se tiver permissão e não for Restantes
            const btnMerge = (currentUser.perm_editar || currentUser.role==='MASTER') && !isLocked ? 
                `<button class="btn btn-sm btn-outline-dark" onclick="window.iniciarMesclagem(${idx}); event.stopPropagation()" title="Juntar com outra rota"><i class="fas fa-object-group"></i></button>` : '';
            
            btnSaveHtml = `
            ${btnMerge}
            <button class="btn btn-sm btn-light text-success border" onclick="window.gerarExcelRota(${idx}); event.stopPropagation()" title="Exportar Excel"><i class="fas fa-file-excel fa-lg"></i></button>
            
            <button class="btn btn-sm btn-light text-success border" onclick="window.abrirGoogleMaps(${idx}); event.stopPropagation()" title="Maps"><i class="fas fa-map-marked-alt fa-lg"></i></button>
            <button class="btn btn-sm btn-light text-dark border" onclick="window.gerarPDF(${idx}); event.stopPropagation()" title="PDF"><i class="fas fa-file-pdf fa-lg"></i></button>
            <button class="btn btn-sm btn-light text-primary border" onclick="window.salvarRotaFirestore(${idx}); event.stopPropagation()" title="Salvar"><i class="fas fa-save fa-lg"></i></button>
            `;
        }
        
        // Botão de Travar (Só Master ou Operador)
        const btnLock = (currentUser.role === 'MASTER' || currentUser.role === 'OPERADOR') ? 
            `<button class="btn btn-link btn-sm p-0 ms-2" onclick="window.toggleTravaRota(${idx}); event.stopPropagation()" title="${isLocked ? 'Destravar' : 'Travar Edição'}">${lockIcon}</button>` : '';

        container.innerHTML += `
        <div class="route-card ${lockClass}" onclick="verRotaNoMapa(${idx})" style="${cardStyle}">
            <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center" style="max-width: 75%; overflow: hidden;">
                    <h6 class="text-primary fw-bold mb-0 text-truncate" title="${nomeRota}">${nomeRota}</h6>
                    ${!isLocked ? `<button class="btn btn-link btn-sm p-0 ms-2 text-secondary" onclick="window.renomearRota(${idx}); event.stopPropagation()"><i class="fas fa-pen"></i></button>` : ''}
                    ${btnLock}
                </div>
                <span class="badge ${badgeColor}">${r.veiculo}</span>
            </div>
            <small class="text-muted d-block mb-2">${r.pedidos.length} peds • ${(r.peso_total/1000).toFixed(1)} ton</small>
            <div class="weight-progress-container"><div class="progress-track"><div class="progress-fill ${barColor}" style="width: ${weightPct.toFixed(1)}%;"></div></div></div>
            
            <div class="freight-inputs-container mt-2" onclick="event.stopPropagation()">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="form-check d-flex align-items-center">
                        <input class="form-check-input" type="radio" name="escolha_${idx}" id="radIti_${idx}" value="ITI" ${(r.frete_manual_iti || 0) < r.frete_manual_fra ? "checked" : ""} ${disabledAttr}>
                        <label class="form-check-label small fw-bold ms-1">Itinerante</label>
                    </div>
                    <input type="number" class="freight-input" id="inIti_${idx}" onchange="recalc(${idx})" placeholder="0.00" style="width: 90px; font-size:0.8rem;" ${disabledAttr}>
                </div>
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="form-check d-flex align-items-center">
                        <input class="form-check-input" type="radio" name="escolha_${idx}" id="radFra_${idx}" value="FRA" ${(r.frete_manual_iti || 0) >= r.frete_manual_fra ? "checked" : ""} ${disabledAttr}>
                        <label class="form-check-label small fw-bold ms-1 text-truncate" title="${resFrac.nome}">${resFrac.nome}</label>
                    </div>
                    <input type="number" class="freight-input" id="inFra_${idx}" value="${resFrac.valor.toFixed(2)}" onchange="recalc(${idx})" style="width: 90px; font-size:0.8rem;" ${disabledAttr}>
                </div>
            </div>
            
            <div id="listaPedidos_${idx}" class="lista-pedidos-container" style="display:none;" onclick="event.stopPropagation()"></div>
            
            <div class="route-actions mt-2 border-top pt-2 d-flex justify-content-between align-items-center">
                <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.toggleListaPedidos(${idx}); event.stopPropagation()">
                    <i class="fas fa-list"></i> EDITAR
                </button>
                <div class="d-flex gap-2">${btnSaveHtml}</div>
            </div>
        </div>`;
    });
    
    rotasGeradas.forEach((_, idx) => recalc(idx));
    if(rotasGeradas.length > 0) setTimeout(() => verRotaNoMapa(0), 100);
}

function recalc(idx) {
    const r = rotasGeradas[idx];
    let elIti = document.getElementById(`inIti_${idx}`);
    let valIti = elIti ? parseFloat(elIti.value) : 0;
    if (isNaN(valIti) || valIti === 0) { valIti = r.frete_manual_iti || (r.custo_calculado || 0); if(elIti) elIti.value = valIti.toFixed(2); }
    let elFra = document.getElementById(`inFra_${idx}`);
    let valFra = elFra ? parseFloat(elFra.value) : 0;
    if (isNaN(valFra)) valFra = r.frete_manual_fra || 0;

    const pctIti = r.valor_total > 0 ? (valIti / r.valor_total) * 100 : 0;
    const pctFra = r.valor_total > 0 ? (valFra / r.valor_total) * 100 : 0;
    const peso = r.peso_total > 0 ? r.peso_total : 1; const km = r.distancia_calculada > 0 ? r.distancia_calculada : 1;

    const elStatsIti = document.getElementById(`statsIti_${idx}`);
    if(elStatsIti) elStatsIti.innerText = `${pctIti.toFixed(2)}% | R$ ${(valIti/peso).toFixed(2)}/kg | R$ ${(valIti/km).toFixed(2)}/km`;
    const elStatsFra = document.getElementById(`statsFra_${idx}`);
    if(elStatsFra) elStatsFra.innerText = `${pctFra.toFixed(2)}% | R$ ${(valFra/peso).toFixed(2)}/kg | R$ ${(valFra/km).toFixed(2)}/km`;

    if(currentRouteIndex === idx && document.getElementById('valItinerante')) {
        document.getElementById('valItinerante').innerText = valIti.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
        document.getElementById('pctItinerante').innerText = pctIti.toFixed(2) + "%";
        document.getElementById('valFracionado').innerText = valFra.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
        document.getElementById('pctFracionado').innerText = pctFra.toFixed(2) + "%";
        const cardI = document.getElementById('cardItinerante'); const cardF = document.getElementById('cardFracionado');
        cardI.classList.remove('winner'); cardF.classList.remove('winner');
        document.getElementById('econItinerante').innerText = ""; document.getElementById('econFracionado').innerText = "";
        if(valIti < valFra) { cardI.classList.add('winner'); document.getElementById('econItinerante').innerText = "Economia: " + (valFra - valIti).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}); } 
        else { cardF.classList.add('winner'); document.getElementById('econFracionado').innerText = "Economia: " + (valIti - valFra).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}); }
    }
    r.frete_manual_iti = valIti; r.frete_manual_fra = valFra;
}

// ===================================================================================
//      FUNÇÃO DE INTELIGENCIA: ROTAS HÍBRIDAS (DIRECTIONS API vs OPTIMIZATION API)
// ===================================================================================
async function verRotaNoMapa(idx) {
    limparMapa(); 
    currentRouteIndex = idx; 
    const rota = rotasGeradas[idx];
    
    // Atualiza Painel de Informações
    document.getElementById('statNome').innerText = rota.id_operacao ? `[${rota.id_operacao}] ${rota.rota_nome}` : rota.rota_nome;
    document.getElementById('statVeiculo').innerText = rota.veiculo; 
    document.getElementById('statValor').innerText = rota.valor_total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});

    // 1. Decide qual API usar
    // O limite grátis da Optimization API é 12 coordenadas (1 Origem + 11 Entregas)
    const USAR_OTIMIZACAO = rota.pedidos.length <= 11; 

    // Prepara as coordenadas: [Origem, ...Pedidos]
    const coords = [rota.origem.coords];
    rota.pedidos.forEach(p => coords.push([p.lon, p.lat]));
    
    // String de coordenadas para URL (lon,lat;lon,lat...)
    const waypointsStr = coords.map(c => c.join(',')).join(';');

    try {
        let geojsonGeometry = null;
        let distKm = 0;
        let duracaoSegundos = 0;

        // =============================================================================
        //     CENÁRIO A: POUCOS PEDIDOS -> OTIMIZAÇÃO AUTOMÁTICA PARA MELHOR TRAJETO
        // =============================================================================
        if (USAR_OTIMIZACAO && rota.pedidos.length > 0) {
            // Avisa o usuário que está pensando
            const loadingMsg = document.createElement('div');
            loadingMsg.id = 'loadingMap';
            loadingMsg.innerHTML = '<span class="badge bg-success shadow p-2"><i class="fas fa-magic fa-spin"></i> Otimizando Rota Inteligente...</span>';
            loadingMsg.style.position = 'absolute'; loadingMsg.style.top = '10px'; loadingMsg.style.left = '50%'; loadingMsg.style.transform = 'translateX(-50%)'; loadingMsg.style.zIndex = '9999';
            document.body.appendChild(loadingMsg);

            // Chama API de Otimização (Optimization v1)
            const res = await fetch(`https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${waypointsStr}?geometries=geojson&source=first&access_token=${MAPBOX_KEY}`);
            const data = await res.json();
            
            if (document.getElementById('loadingMap')) document.getElementById('loadingMap').remove();

            if (data.trips && data.trips[0]) {
                const trip = data.trips[0];
                geojsonGeometry = trip.geometry;
                distKm = trip.distance / 1000;
                duracaoSegundos = trip.duration;

                // --- REORDENAR A LISTA ---
                // A API devolve a ordem otimizada. Precisamos atualizar nossa lista visual.
                // A ordem vem em 'waypoints'. O primeiro é a origem (waypoint_index 0).
                
                const novaOrdemPedidos = [];
                // Pula o primeiro (origem) e pega os próximos
                trip.waypoints.forEach(wp => {
                    if (wp.waypoint_index !== 0) { // Ignora a origem
                        // O waypoint_index corresponde à posição no array original 'coords'
                        // coords[0] é origem. coords[1] é pedido[0], coords[2] é pedido[1]...
                        // Então indicePedido = waypoint_index - 1
                        const indiceOriginal = wp.waypoint_index - 1;
                        if (indiceOriginal >= 0) {
                            novaOrdemPedidos.push(rota.pedidos[indiceOriginal]);
                        }
                    }
                });

                // Atualiza o array da rota com a nova ordem perfeita
                rota.pedidos = novaOrdemPedidos;
                
                // Redesenha a lista lateral para refletir a nova ordem
                renderizarListaPedidos(idx);
                
                // Feedback visual
                // alert("Rota reorganizada para economizar combustível!");
            }
        } 
        // =====================================================================
        //         CENÁRIO B: MUITOS PEDIDOS -> ROTA PADRÃO (Directions)
        // =====================================================================
        else {
            // Chama API de Direção Comum (Directions v5)
            // Divide em chunks se tiver mais de 25 pontos (limite da Directions)
            // Simplificado aqui para o fluxo principal
            const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${waypointsStr}?geometries=geojson&access_token=${MAPBOX_KEY}`);
            const data = await res.json();
            
            if (data.routes && data.routes[0]) {
                geojsonGeometry = data.routes[0].geometry;
                distKm = data.routes[0].distance / 1000;
                duracaoSegundos = data.routes[0].duration;
            }
        }

        // =====================================================================
        //          ATUALIZAÇÃO DA TELA (COMUM PARA OS DOIS CASOS)
        // =====================================================================
        
        // 1. Atualiza totais na tela
        rota.distancia_calculada = distKm;
        document.getElementById('statDist').innerText = distKm.toFixed(1) + " km";
        const hours = Math.floor((duracaoSegundos/60)/60); 
        const mins = Math.floor((duracaoSegundos/60)%60); 
        document.getElementById('statTempoTotal').innerText = `${hours}h ${mins}m`;
        
        // Estimativa de prazo
        if(distKm > 0) { 
            const d = Math.ceil(distKm / 350) + 2; 
            const elP = document.getElementById('statPrazoFrac');
            if(elP) elP.innerText = `~${d} a ${d + 1} dias úteis`; 
        }

        // 2. Calcula Custo
        let custoRisco = 0; // (Lógica de risco simplificada)
        rota.custo_calculado = (distKm * rota.custo_km_base) + custoRisco;
        
        // Atualiza input de custo se estiver vazio
        const inIti = document.getElementById(`inIti_${idx}`); 
        if(inIti && (!inIti.value || inIti.value == 0)) { inIti.value = rota.custo_calculado.toFixed(2); }
        recalc(idx);

        // 3. Desenha a Linha Azul
        if (geojsonGeometry) {
            const isVisible = document.getElementById('toggleRouteLine')?.checked !== false ? 'visible' : 'none';
            if (map.getSource('route')) { 
                map.getSource('route').setData({type:'Feature', geometry: geojsonGeometry}); 
                map.setLayoutProperty('route', 'visibility', isVisible); 
            } else { 
                map.addSource('route', { type: 'geojson', data: {type:'Feature', geometry: geojsonGeometry} }); 
                map.addLayer({id:'route', type:'line', source:'route', layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': isVisible }, paint:{'line-color':'#0d6efd', 'line-width':4}}); 
            }
        }

        // 4. Desenha os Marcadores (Agora na ordem certa!)
        markers = [];
        // Marcador Origem
        new mapboxgl.Marker({color:'red'}).setLngLat(rota.origem.coords).setPopup(new mapboxgl.Popup().setHTML(`<b>ORIGEM: ${rota.origem.nome}</b>`)).addTo(map);

        rota.pedidos.forEach((p, i) => {
            const el = document.createElement('div'); 
            // Estilo do pino
            if(rota.pedidos.length > 30) { 
                el.style.cssText = "background:#6f42c1; width:10px; height:10px; border-radius:50%; border:1px solid white; cursor:pointer;"; 
            } else { 
                // Se foi otimizado, o número 1, 2, 3 agora reflete a melhor sequência
                const isOtimizado = USAR_OTIMIZACAO ? "border-color: #198754;" : ""; // Borda verde se otimizado
                el.style.cssText = `background:#0d6efd; color:white; width:24px; height:24px; border-radius:50%; text-align:center; font-weight:bold; border:2px solid white; ${isOtimizado}`; 
                el.innerText = i+1; 
            }
            
            const popupHTML = `<div class="text-center"><b>${p.ID}</b><br>${p.ENDERECO}<br><div class="my-1 fw-bold text-success">NF: R$ ${p.VALOR.toLocaleString('pt-BR')}</div><button class="btn btn-sm btn-danger w-100" onclick="window.removerPedidoDaRota(${idx}, ${i})">Remover</button></div>`;
            
            const m = new mapboxgl.Marker(el).setLngLat([p.lon, p.lat]).setPopup(new mapboxgl.Popup().setHTML(popupHTML)).addTo(map); 
            markers.push(m);
        });

        // Enquadra o mapa
        const b = new mapboxgl.LngLatBounds(); 
        coords.forEach(c => b.extend(c)); 
        map.fitBounds(b, {padding: 50});

        document.getElementById('routeStats').style.display='block';

    } catch(e) { 
        console.error("Erro Mapbox:", e); 
        alert("Erro ao traçar rota: " + e.message);
    }
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

// VERSÃO FINAL: DRAG AND DROP PURO (SEM SETAS)
// ATUALIZADO: CLIQUE NA LISTA LEVA AO MAPA
function renderizarListaPedidos(idx) {
    const rota = rotasGeradas[idx];
    const div = document.getElementById(`listaPedidos_${idx}`);
    const isLocked = rota.locked === true;
    
    if (isLocked) {
        div.innerHTML = `<div class="p-2 text-center text-muted small"><i class="fas fa-lock"></i> Rota travada.</div>`;
        return;
    }

    let html = '';
    rota.pedidos.forEach((p, i) => {
        // Ícone de Grip (Pegada)
        const gripIcon = `<i class="fas fa-grip-vertical text-secondary opacity-25 me-2" style="cursor: grab;"></i>`;
        
        // Botão de Transferir
        let optionsRotas = `<option value="" selected disabled>mover...</option>`;
        rotasGeradas.forEach((r, rIdx) => {
            if(rIdx !== idx) optionsRotas += `<option value="${rIdx}">➡ ${r.rota_nome}</option>`;
        });
        optionsRotas += `<option value="NOVA">+ Nova</option>`;

        const transferSelect = `
            <select class="form-select form-select-sm border-0 bg-transparent text-primary fw-bold py-0 ps-1" 
                    style="width: 20px; cursor:pointer;" 
                    onchange="window.transferirPedidoRota(${idx}, ${i}, this.value)" title="Mover para outra rota" onclick="event.stopPropagation()">
                <option value="">﹥</option>
                ${optionsRotas}
            </select>
        `;

        html += `
        <div class="lista-row border-bottom p-2 d-flex align-items-center bg-white draggable-item"
             draggable="true"
             data-index="${i}"
             ondragstart="window.dragStart(event, ${idx}, ${i})"
             ondragover="window.dragOver(event)"
             ondrop="window.drop(event, ${idx}, ${i})"
             ondragenter="this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')">
            
            <div title="Segure para reordenar">
                ${gripIcon}
            </div>

            <div style="flex:1; overflow:hidden; cursor: pointer;" 
                 onclick="window.destacarPedidoNoMapa(${idx}, ${i})" 
                 title="Ver no mapa">
                <div class="d-flex align-items-center">
                    <span class="badge bg-light text-dark border me-1">${i+1}</span>
                    <span class="fw-bold text-dark small text-truncate">${p.ID}</span>
                    ${transferSelect} 
                </div>
                <div class="text-muted small text-truncate" style="font-size: 0.75rem;">
                    ${p.ENDERECO}
                </div>
            </div>

            <div class="text-end" style="width: 70px;">
                <div class="fw-bold text-success small">R$${p.VALOR.toLocaleString('pt-BR', {compact:'short'})}</div>
                <i class="fas fa-trash-alt text-danger cursor-pointer mt-1 opacity-50 hover-opacity-100" 
                   onclick="window.removerPedidoDaRota(${idx}, ${i})" title="Remover"></i>
            </div>
        </div>`;
    });
    
    // CSS Inline para hover
    const style = `
    <style>
        .draggable-item { transition: background 0.1s; }
        .draggable-item:hover { background-color: #f0f8ff !important; } /* Azulzinho claro ao passar o mouse */
        .draggable-item.dragging { opacity: 0.5; background: #e9ecef; border: 2px dashed #0d6efd; }
        .drag-over { border-top: 3px solid #0d6efd !important; }
        .hover-opacity-100:hover { opacity: 1 !important; }
    </style>`;
    
    div.innerHTML = html + style;
}

// ATUALIZADO: MANTÉM A LISTA ABERTA APÓS EXCLUIR
window.removerPedidoDaRota = function(rIdx, pIdx) {
    // 1. Segurança
    if (currentUser.role !== 'MASTER' && currentUser.role !== 'OPERADOR' && !currentUser.perm_editar) {
        return alert("Acesso Negado.");
    }

    const rota = rotasGeradas[rIdx];
    
    // 2. Remove o pedido do array
    const removido = rota.pedidos.splice(pIdx, 1)[0];
    recalcularRotaInfo(rota);
    
    // 3. Adiciona na Rota de Sobras (Restantes)
    let idxRest = rotasGeradas.findIndex(r => r.rota_nome && r.rota_nome.includes("RESTANTES"));
    if (idxRest === -1) {
        rotasGeradas.push({ 
            rota_nome: "ROTA RESTANTES (" + new Date().toLocaleDateString() + ")", 
            pedidos: [removido], peso_total: 0, valor_total: 0, 
            veiculo: "Pendente", custo_km_base: 6.50, origem: rota.origem, 
            distancia_calculada: 0, frete_manual_iti: 0, frete_manual_fra: 0 
        });
        idxRest = rotasGeradas.length - 1;
    } else {
        rotasGeradas[idxRest].pedidos.push(removido);
    }
    recalcularRotaInfo(rotasGeradas[idxRest]);
    
    // 4. Atualiza a tela (Isso fecharia a lista por padrão)
    mostrarResultados(); 
    
    // 5. O PULO DO GATO: Reabre a lista automaticamente
    const divLista = document.getElementById(`listaPedidos_${rIdx}`);
    if(divLista) {
        divLista.style.display = 'block'; // Força aparecer
        renderizarListaPedidos(rIdx); // Desenha os itens dentro
    }

    // 6. Atualiza o mapa se a rota estiver selecionada
    if(currentRouteIndex === rIdx) verRotaNoMapa(rIdx);
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
// VISUALIZAÇÃO NO MAPA (COM CÁLCULO DE DIAS E PRAZOS) - DUPLICATA MANTIDA
// ==============================================================
/*
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
                
                return fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?geometries=geojson&access_token=${MAPBOX_KEY}`).then(res => res.json());
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
*/


// ==============================================================
//          FUNÇÕES AUXILIARES, CÁLCULOS FINAIS E FIREBASE
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

   // --- GERAÇÃO DO LINK INTELIGENTE (ATUALIZADO PARA PASTAS) ---
    
    // Pega o domínio principal
    const dominio = window.location.origin;
    
    // Monta o link apontando para a pasta vizinha "transportador"
    const linkPortal = `${dominio}/transportador/index.html?op=${idOp}`;

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

// =============================================================================
//              FUNÇÃO - EXPORTAR PEDIDOS DA ROTA PARA EXCEL
// =============================================================================
window.gerarExcelRota = function(idx) {
    const rota = rotasGeradas[idx];
    if (!rota || !rota.pedidos || rota.pedidos.length === 0) {
        return alert("Rota vazia ou inválida.");
    }

    // 1. Prepara os dados (Colunas do Excel)
    const dadosExcel = rota.pedidos.map((p, i) => ({
        "Sequência": i + 1,
        "ID Pedido": p.ID,
        "Endereço / Destino": p.ENDERECO,
        "UF": p.UF || "-",
        "Peso (kg)": p.PESO,
        "Valor Nota (R$)": p.VALOR,
        "Volume (m³)": p.CUBAGEM || 0,
        "Descarga": p.DESCARGA || "-"
    }));

    // 2. Adiciona uma linha final com os totais
    dadosExcel.push({}); // Linha em branco
    dadosExcel.push({
        "Sequência": "TOTAIS",
        "Peso (kg)": rota.peso_total,
        "Valor Nota (R$)": rota.valor_total
    });

    // 3. Cria a planilha
    const ws = XLSX.utils.json_to_sheet(dadosExcel);
    const wb = XLSX.utils.book_new();
    
    // Ajusta largura das colunas (Opcional, mas fica mais bonito)
    const wscols = [
        {wch: 10}, // Seq
        {wch: 15}, // ID
        {wch: 50}, // Endereço
        {wch: 5},  // UF
        {wch: 12}, // Peso
        {wch: 15}, // Valor
        {wch: 10}, // Volume
        {wch: 15}  // Descarga
    ];
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, "Pedidos da Rota");

    // 4. Gera o nome do arquivo limpo
    let nomeArquivo = rota.rota_nome || `Rota_${idx + 1}`;
    nomeArquivo = nomeArquivo.replace(/[^a-z0-9]/gi, '_'); // Remove caracteres especiais do nome

    // 5. Baixa o arquivo
    XLSX.writeFile(wb, `Manifesto_${nomeArquivo}.xlsx`);
};


// Excluir do Banco (Histórico/Risco)
function delDoc(col, id) { 
    if (!currentUser.perm_excluir) return alert("Sem permissão para excluir registros.");
    if(confirm("Apagar permanentemente?")) {
        db.collection(col).doc(id).delete().then(() => { 
            if(col==='historico') carregarHistorico(); 
            if(col==='areas_risco') carregarRiscos(); 
            if(col==='transportadores') carregarTransportadores(); 
        }); 
    }
}

async function salvarRisco() {
    const addr = document.getElementById('riskAddr').value; if(!addr) return;
    try { const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${MAPBOX_KEY}&limit=1`); const d = await res.json();
    if(d.features?.length) db.collection("areas_risco").add({ descricao: document.getElementById('riskDesc').value, custo_extra: parseFloat(document.getElementById('riskCost').value), raio: parseInt(document.getElementById('riskRadius').value), lat: d.features[0].center[1], lon: d.features[0].center[0] }).then(()=>{alert("Salvo!"); carregarRiscos();});
    } catch(e){}
}

// =============================================================================
// CORREÇÃO: CARREGAR RISCOS E IR PARA O LOCAL
// =============================================================================


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
//          LÓGICA DE REDIMENSIONAMENTO DA SIDEBAR (NOVO)
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

// =============================================================================
//          MÓDULO 8: BACKLOG E SOBRAS (VISUALIZAR E RESGATAR)
// =============================================================================

// 1. VISUALIZAR PENDENTES (NOVO)
window.verPendentes = function() {
    showLoading(true, "Buscando...");
    
    db.collection("pedidos_pendentes")
        .where("filial_origem", "==", currentUser.cd)
        .where("status", "==", "PENDENTE")
        .get()
        .then(snap => {
            showLoading(false);
            
            if (snap.empty) {
                return alert("Nenhum pedido pendente no banco.");
            }
            
            const tbody = document.getElementById('listaSobrasBody');
            tbody.innerHTML = "";
            let totalPeso = 0;
            let totalValor = 0;
            let count = 0;
            
            snap.forEach(doc => {
                const p = doc.data();
                const peso = parseFloat(p.PESO) || 0;
                const valor = parseFloat(p.VALOR) || 0;
                totalPeso += peso;
                totalValor += valor;
                count++;
                
                tbody.innerHTML += `
                <tr>
                    <td><span class="badge bg-secondary">${p.ID}</span></td>
                    <td class="text-truncate" style="max-width: 200px;" title="${p.ENDERECO}">${p.ENDERECO}</td>
                    <td>${peso} kg</td>
                    <td>R$ ${valor.toLocaleString('pt-BR')}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-danger" onclick="excluirPendenteIndividual('${doc.id}')" title="Excluir Definitivamente">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>`;
            });
            
            // Atualiza resumo
            document.getElementById('resumoSobras').innerHTML = `${count} pedidos • ${totalPeso} kg • R$ ${totalValor.toLocaleString('pt-BR')}`;
            
            // Abre Modal
            const modal = new bootstrap.Modal(document.getElementById('modalSobras'));
            modal.show();
        })
        .catch(err => {
            showLoading(false);
            alert("Erro: " + err.message);
        });
};

// 2. EXCLUIR UM PEDIDO DO BACKLOG (NOVO)
window.excluirPendenteIndividual = function(docId) {
    // TRAVA DE SEGURANÇA
    if (currentUser.role !== 'MASTER') {
        return alert("ACESSO NEGADO: Somente usuários MASTER podem limpar o backlog.");
    }

    if(!confirm("Excluir este pedido permanentemente do Backlog?")) return;
    
    db.collection("pedidos_pendentes").doc(docId).delete().then(() => {
        window.verPendentes();
        atualizarContadorPendentes();
    });
};

// 3. SALVAR SOBRAS GERAL
window.salvarSobrasPendentes = async function() {
    if (!todosPedidosBackup || todosPedidosBackup.length === 0) return alert("Sem pedidos.");
    const idsRoteirizados = new Set(); 
    rotasGeradas.forEach(r => { if(!r.rota_nome.toUpperCase().includes("RESTANTES")) r.pedidos.forEach(p => idsRoteirizados.add(p.ID)); });
    const sobras = todosPedidosBackup.filter(p => !idsRoteirizados.has(p.ID));
    if (sobras.length === 0) return alert("Sem sobras.");
    if(!confirm(`Salvar ${sobras.length} pedidos?`)) return;
    showLoading(true, "Salvando...");
    const b = db.batch(); let c = 0;
    sobras.forEach(p => { const ref = db.collection("pedidos_pendentes").doc(`${p.ID}_${currentUser.cd}`.replace(/\//g, "-")); b.set(ref, { ...p, filial_origem: currentUser.cd, status: "PENDENTE", data_pendencia: new Date().toISOString() }); c++; });
    await b.commit(); showLoading(false); alert(`${c} salvos.`); atualizarContadorPendentes();
};

window.arquivarRotaRestante = async function(idx) {
    const rota = rotasGeradas[idx]; if(!rota) return;
    if(!confirm("Arquivar no Backlog?")) return;
    showLoading(true, "Arquivando...");
    const b = db.batch();
    rota.pedidos.forEach(p => { const ref = db.collection("pedidos_pendentes").doc(`${p.ID}_${currentUser.cd}`.replace(/\//g, "-")); b.set(ref, { ...p, filial_origem: currentUser.cd, status: "PENDENTE", data_pendencia: new Date().toISOString() }); });
    await b.commit(); showLoading(false); alert("Arquivado!"); rotasGeradas.splice(idx, 1); mostrarResultados(); if(rotasGeradas.length>0) verRotaNoMapa(0); else limparMapa(); atualizarContadorPendentes();
};

window.resgatarPendentes = function() {
    showLoading(true);
    db.collection("pedidos_pendentes").where("filial_origem", "==", currentUser.cd).where("status", "==", "PENDENTE").get().then(snap => {
        if(snap.empty) { showLoading(false); return alert("Nada pendente."); }
        let c = 0; const ids = new Set(pedidosPorCD[currentCD].map(p => p.ID));
        snap.forEach(doc => { const p = doc.data(); if(!ids.has(p.ID)) { pedidosPorCD[currentCD].push(p); c++; } db.collection("pedidos_pendentes").doc(doc.id).delete(); });
        todosPedidosBackup = [...pedidosPorCD[currentCD]]; atualizarListaPedidos(); showLoading(false); alert(`${c} resgatados.`); atualizarContadorPendentes();
    });
};

window.atualizarContadorPendentes = function() {
    const badge = document.getElementById('badgePendentes'); if(!badge) return;
    db.collection("pedidos_pendentes").where("filial_origem", "==", currentUser.cd).get().then(snap => {
        badge.innerText = snap.size;
        if(snap.size > 0) { badge.classList.remove('bg-dark'); badge.classList.add('bg-danger'); } else { badge.classList.add('bg-dark'); badge.classList.remove('bg-danger'); }
    });
};
setTimeout(atualizarContadorPendentes, 2000);

// =============================================================================
// MÓDULO 9: UTILITÁRIOS E FUNÇÕES VISUAIS (RISCOS E OUTROS)
// =============================================================================

function carregarRiscos() { 
    const div = document.getElementById('listaRiscos'); 
    if (!div) return;

    // Loading rápido visual
    div.innerHTML = "<div class='text-center p-3 text-muted'><i class='fas fa-spinner fa-spin'></i> Carregando riscos...</div>";

    db.collection("areas_risco").get().then(q => { 
        risksCache = []; 
        div.innerHTML = ""; 
        
        if(q.empty) {
            div.innerHTML = "<div class='alert alert-light text-center small text-muted'>Nenhuma área de risco cadastrada.</div>";
            return;
        }

        q.forEach(doc => { 
            const d = doc.data(); 
            risksCache.push(d); 
            
            // VISUAL NOVO: CARD CLICÁVEL
            // Adicionei classe 'card', sombra, borda vermelha e cursor pointer
            div.innerHTML += `
            <div class="card mb-2 shadow-sm border-start border-danger border-3 risk-card" 
                 style="transition: all 0.2s; cursor: pointer; border-radius: 8px;">
                
                <div class="card-body p-2 d-flex justify-content-between align-items-center">
                    
                    <div style="flex: 1;" onclick="window.irParaRisco(${d.lat}, ${d.lon})" title="Ver no Mapa">
                        <div class="fw-bold text-danger" style="font-size: 0.9rem;">
                            <i class="fas fa-exclamation-triangle me-1"></i> ${d.descricao}
                        </div>
                        <div class="text-muted small">
                            Custo: <strong>R$ ${parseFloat(d.custo_extra).toLocaleString('pt-BR')}</strong> • Raio: ${d.raio}m
                        </div>
                    </div>

                    <button class="btn btn-sm text-secondary hover-danger ms-2" 
                            onclick="event.stopPropagation(); window.delDoc('areas_risco','${doc.id}')" 
                            title="Excluir Risco">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>`; 
        }); 
        
        // Redesenha as bolinhas vermelhas no mapa
        desenharRiscosNoMapa(); 
    }); 
}

// Função de Zoom no Mapa (Com Highlight)
window.irParaRisco = function(lat, lon) {
    if (lat && lon) {
        // Voa para o local
        map.flyTo({ 
            center: [lon, lat], 
            zoom: 14, 
            speed: 1.8,
            essential: true 
        });
        
        // Mostra um Popup temporário para identificar
        new mapboxgl.Popup({closeOnClick: true, closeButton: false})
            .setLngLat([lon, lat])
            .setHTML(`<div class="badge bg-danger text-white p-2">📍 ÁREA DE RISCO AQUI</div>`)
            .addTo(map);
            
    } else {
        alert("Este cadastro não possui coordenadas válidas.");
    }
};

// Funções Auxiliares mantidas
function desenharRiscosNoMapa() {
    if (map.getLayer('riscos-layer')) map.removeLayer('riscos-layer');
    if (map.getSource('riscos-source')) map.removeSource('riscos-source');
    
    const features = risksCache.map(r => { 
        if(r.lat && r.lon) { 
            return turf.circle([r.lon, r.lat], r.raio/1000, {steps: 64, units: 'kilometers', properties: {description: r.descricao}}); 
        } 
    }).filter(f => f);
    
    if(features.length > 0) { 
        map.addSource('riscos-source', { type: 'geojson', data: { type: 'FeatureCollection', features: features } }); 
        map.addLayer({ id: 'riscos-layer', type: 'fill', source: 'riscos-source', layout: {}, paint: { 'fill-color': '#dc3545', 'fill-opacity': 0.35, 'fill-outline-color': '#b02a37' } }); 
    }
}

// Função rápida para adicionar estilo de hover (Opcional, mas melhora a UX)
const styleRisk = document.createElement('style');
styleRisk.innerHTML = `
    .risk-card:hover { transform: translateX(3px); background-color: #fff5f5; }
    .hover-danger:hover { color: #dc3545 !important; }
`;
document.head.appendChild(styleRisk);
// =============================================================================
//              MÓDULO 10: INTERAÇÃO COM A ROTA (O GRANDE FIX)
// =============================================================================

window.toggleListaPedidos = function(idx) {
    const d = document.getElementById(`listaPedidos_${idx}`);
    if (d.style.display === 'none') { renderizarListaPedidos(idx); d.style.display = 'block'; } else d.style.display = 'none';
};

// ATUALIZADO: LISTA CLICÁVEL PARA DESTAQUE
function renderizarListaPedidos(idx) {
    const rota = rotasGeradas[idx];
    const div = document.getElementById(`listaPedidos_${idx}`);
    const isLocked = rota.locked === true;
    
    if (isLocked) {
        div.innerHTML = `<div class="p-2 text-center text-muted small"><i class="fas fa-lock"></i> Rota travada. Destrave para editar.</div>`;
        return;
    }

    let html = '';
    rota.pedidos.forEach((p, i) => {
        // Ícone de Grip (Pegada)
        const gripIcon = `<i class="fas fa-grip-vertical text-secondary opacity-50 me-2" style="cursor: grab; font-size: 1.2rem;"></i>`;
        
        // Menu de transferência
        let optionsRotas = `<option value="" selected disabled>mover...</option>`;
        rotasGeradas.forEach((r, rIdx) => {
            if(rIdx !== idx) optionsRotas += `<option value="${rIdx}">➡ ${r.rota_nome}</option>`;
        });
        optionsRotas += `<option value="NOVA">+ Nova</option>`;

        const transferSelect = `
            <select class="form-select form-select-sm border-0 bg-transparent text-primary fw-bold py-0 ps-1" 
                    style="width: 20px; cursor:pointer;" 
                    onchange="window.transferirPedidoRota(${idx}, ${i}, this.value)" 
                    onclick="event.stopPropagation()" 
                    title="Mover para outra rota">
                <option value="">﹥</option>
                ${optionsRotas}
            </select>
        `;

        html += `
        <div class="lista-row border-bottom p-2 d-flex align-items-center bg-white draggable-item"
             draggable="true"
             data-index="${i}"
             ondragstart="window.dragStart(event, ${idx}, ${i})"
             ondragover="window.dragOver(event)"
             ondrop="window.drop(event, ${idx}, ${i})"
             ondragenter="this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')">
            
            <div title="Segure e arraste para reordenar">${gripIcon}</div>

            <div style="flex:1; overflow:hidden; cursor: pointer;" 
                 onclick="window.destacarPedidoNoMapa(${idx}, ${i})"
                 title="Clique para destacar no mapa">
                 
                <div class="d-flex align-items-center">
                    <span class="badge bg-light text-dark border me-1">${i+1}</span>
                    <span class="fw-bold text-dark small text-truncate">${p.ID}</span>
                    ${transferSelect} 
                </div>
                <div class="text-muted small text-truncate" style="font-size: 0.75rem;">
                    ${p.ENDERECO}
                </div>
            </div>

            <div class="text-end" style="width: 70px;">
                <div class="fw-bold text-success small">R$${p.VALOR.toLocaleString('pt-BR', {compact:'short'})}</div>
                <i class="fas fa-trash-alt text-danger cursor-pointer mt-1 opacity-50 hover-opacity-100" 
                   onclick="event.stopPropagation(); window.removerPedidoDaRota(${idx}, ${i})" 
                   title="Remover"></i>
            </div>
        </div>`;
    });
    
    // CSS Inline para o Drag & Drop e Hover
    const style = `
    <style>
        .draggable-item { cursor: grab; transition: background 0.1s; }
        .draggable-item:hover { background-color: #f8f9fa !important; }
        .draggable-item:active { cursor: grabbing; }
        .draggable-item.dragging { opacity: 0.5; background: #e9ecef; border: 2px dashed #0d6efd; }
        .drag-over { border-top: 3px solid #0d6efd !important; transform: translateY(2px); }
        .hover-opacity-100:hover { opacity: 1 !important; }
    </style>`;
    
    div.innerHTML = html + style;
}

window.removerPedidoDaRota = function(rIdx, pIdx) {
    // 1. Verifica Permissão
    if (currentUser.role !== 'MASTER' && currentUser.role !== 'OPERADOR' && !currentUser.perm_editar) {
        return alert("Acesso Negado.");
    }

    const rota = rotasGeradas[rIdx];
    
    // 2. Remove o pedido e guarda ele
    const removido = rota.pedidos.splice(pIdx, 1)[0];
    
    // 3. Joga para a rota de Sobras (Restantes)
    let idxRest = rotasGeradas.findIndex(r => r.rota_nome && r.rota_nome.includes("RESTANTES"));
    if (idxRest === -1) {
        // Se não existe rota de sobras, cria uma
        rotasGeradas.push({ 
            rota_nome: "ROTA RESTANTES (" + new Date().toLocaleDateString() + ")", 
            pedidos: [removido], peso_total: 0, valor_total: 0, 
            veiculo: "Pendente", custo_km_base: 6.50, origem: rota.origem, 
            distancia_calculada: 0, frete_manual_iti: 0, frete_manual_fra: 0 
        });
        idxRest = rotasGeradas.length - 1;
    } else {
        rotasGeradas[idxRest].pedidos.push(removido);
    }
    
    // 4. Recalcula os totais (Peso/Valor)
    recalcularRotaInfo(rota);
    recalcularRotaInfo(rotasGeradas[idxRest]);
    
    // 5. Atualiza a Tela Geral (Isso fecharia a lista por padrão)
    mostrarResultados(); 
    
    // 6. O FIX: Reabre a lista e desenha os itens
    const divLista = document.getElementById(`listaPedidos_${rIdx}`);
    if(divLista) {
        divLista.style.display = 'block'; // Força ficar visível
        renderizarListaPedidos(rIdx);     // Desenha os pedidos dentro
    }

    // 7. Atualiza o Mapa (para remover o pino excluído)
    if(currentRouteIndex === rIdx) verRotaNoMapa(rIdx);
};

window.moverParaOutroCD = function(targetKey, rIdx, pIdx) {
    if(!confirm("Mover pedido?")) return;
    const rota = rotasGeradas[rIdx]; const p = rota.pedidos[pIdx];
    if(!pedidosPorCD[targetKey]) pedidosPorCD[targetKey] = [];
    pedidosPorCD[targetKey].push(p);
    rota.pedidos.splice(pIdx, 1);
    recalcularRotaInfo(rota);
    alert("Movido com sucesso!");
    mostrarResultados(); verRotaNoMapa(rIdx);
};

window.renomearRota = function(idx) {
    const novo = prompt("Novo nome:", rotasGeradas[idx].rota_nome);
    if(novo) { rotasGeradas[idx].rota_nome = novo; mostrarResultados(); }
};

function recalcularRotaInfo(rota) {
    rota.peso_total = rota.pedidos.reduce((a, b) => a + b.PESO, 0);
    rota.valor_total = rota.pedidos.reduce((a, b) => a + b.VALOR, 0);
    rota.veiculo = rota.peso_total <= 12000 ? "Truck" : (rota.peso_total <= 27000 ? "Carreta" : "Macro");
    rota.custo_km_base = rota.peso_total <= 12000 ? CUSTO_TRUCK : CUSTO_CARRETA;
    rota.frete_manual_iti = 0; rota.frete_manual_fra = 0;
}

// =============================================================================
//              MÓDULO 11: GESTÃO DE USUÁRIOS E PERMISSÕES (ATUALIZADO)
// =============================================================================

window.carregarListaUsuarios = function() {
    if (currentUser.role !== 'MASTER') return;
    
    const container = document.getElementById('listaUsuariosContainer');
    if(!container) return;
    container.innerHTML = '<div class="text-center p-3 text-muted"><i class="fas fa-spinner fa-spin"></i> Buscando usuários...</div>';

    db.collection("users").orderBy("last_login", "desc").get().then(snap => {
        container.innerHTML = "";
        snap.forEach(doc => {
            const u = doc.data();
            const cor = u.role === "MASTER" ? "danger" : (u.role === "OPERADOR" ? "primary" : "secondary");
            
            // Ícones de permissão
            const icoExcluir = u.perm_excluir ? '<i class="fas fa-trash text-danger" title="Pode Excluir"></i>' : '<i class="fas fa-trash text-muted opacity-25"></i>';
            const icoEditar = u.perm_editar ? '<i class="fas fa-edit text-primary" title="Pode Editar"></i>' : '<i class="fas fa-edit text-muted opacity-25"></i>';
            const icoFin = u.perm_financeiro ? '<i class="fas fa-dollar-sign text-success" title="Ver Financeiro"></i>' : '<i class="fas fa-dollar-sign text-muted opacity-25"></i>';

            container.innerHTML += `
            <div class="user-item">
                <div>
                    <div class="fw-bold small text-dark">${u.email}</div>
                    <div class="mt-1 d-flex align-items-center gap-2">
                        <span class="badge bg-${cor} badge-role">${u.role}</span>
                        <div class="border-start ps-2 d-flex gap-1">${icoExcluir} ${icoEditar} ${icoFin}</div>
                    </div>
                </div>
                <button class="btn btn-sm btn-outline-dark" onclick="abrirEditorUsuario('${doc.id}', '${u.email}', '${u.role}', ${u.perm_excluir}, ${u.perm_editar}, ${u.perm_financeiro})">
                    <i class="fas fa-cog"></i>
                </button>
            </div>`;
        });
    });
};

window.abrirEditorUsuario = function(uid, email, role, pExcluir, pEditar, pFin) {
    document.getElementById('editUid').value = uid;
    document.getElementById('editEmail').value = email;
    document.getElementById('editRole').value = role;
    
    // Marca as caixinhas
    document.getElementById('chkExcluir').checked = pExcluir || false;
    document.getElementById('chkEditar').checked = pEditar || false;
    document.getElementById('chkFinanceiro').checked = pFin || false;
    
    new bootstrap.Modal(document.getElementById('modalPermissoes')).show();
};

window.salvarPermissoesUsuario = function() {
    const uid = document.getElementById('editUid').value;
    const role = document.getElementById('editRole').value;
    
    const permData = {
        role: role,
        perm_excluir: document.getElementById('chkExcluir').checked,
        perm_editar: document.getElementById('chkEditar').checked,
        perm_financeiro: document.getElementById('chkFinanceiro').checked
    };
    
    // Se virou Master, força tudo True
    if (role === 'MASTER') {
        permData.perm_excluir = true;
        permData.perm_editar = true;
        permData.perm_financeiro = true;
    }

    if (uid === currentUser.uid && role !== 'MASTER') {
        if(!confirm("Cuidado! Você está removendo seu próprio acesso de MASTER.")) return;
    }

    db.collection("users").doc(uid).update(permData).then(() => {
        alert("Permissões salvas!");
        bootstrap.Modal.getInstance(document.getElementById('modalPermissoes')).hide();
        carregarListaUsuarios();
    }).catch(err => alert("Erro: " + err.message));
};

// =============================================================================
//                  MÓDULO 12: EDIÇÃO AVANÇADA DE ROTAS (NOVO)
// =============================================================================

// 1. TRAVAR/DESTRAVAR ROTA
window.toggleTravaRota = function(idx) {
    if (currentUser.role !== 'MASTER' && currentUser.role !== 'OPERADOR') return alert("Permissão negada.");
    rotasGeradas[idx].locked = !rotasGeradas[idx].locked;
    mostrarResultados();
};

// 2. REORDENAR (Subir/Descer)
window.moverOrdemPedido = function(rIdx, pIdx, direction) {
    // Segurança
    if (!currentUser.perm_editar && currentUser.role !== 'MASTER' && currentUser.role !== 'OPERADOR') return;
    
    const rota = rotasGeradas[rIdx];
    if (rota.locked) return alert("Rota travada.");

    const targetIdx = pIdx + direction;
    // Evita erro de índice
    if (targetIdx < 0 || targetIdx >= rota.pedidos.length) return;
    
    // Troca de posição
    const temp = rota.pedidos[pIdx];
    rota.pedidos[pIdx] = rota.pedidos[targetIdx];
    rota.pedidos[targetIdx] = temp;
    
    // Atualiza visual
    renderizarListaPedidos(rIdx);
    
    // Redesenha o mapa (Importante para o traçado mudar se a ordem mudou)
    verRotaNoMapa(rIdx);
};
// 3. TRANSFERIR PARA OUTRA ROTA
// ATUALIZADO: RECALCULA E ATUALIZA O MAPA AUTOMATICAMENTE
window.transferirPedidoRota = function(origemIdx, pIdx, destinoVal) {
    if (!destinoVal) return;
    
    // Verifica permissão
    if (!currentUser.perm_editar && currentUser.role !== 'MASTER' && currentUser.role !== 'OPERADOR') {
        alert("Sem permissão para editar.");
        return renderizarListaPedidos(origemIdx); // Reseta o select
    }

    // 1. Pega o pedido
    const pedido = rotasGeradas[origemIdx].pedidos[pIdx];

    // 2. Remove da Origem
    rotasGeradas[origemIdx].pedidos.splice(pIdx, 1);

    // 3. Adiciona no Destino
    let destinoIdx;
    if (destinoVal === 'NOVA') {
        // Cria uma nova rota vazia
        rotasGeradas.push({
            rota_nome: `NOVA ROTA ${rotasGeradas.length + 1}`,
            pedidos: [], peso_total: 0, valor_total: 0, veiculo: "Truck", custo_km_base: 6.50, origem: rotasGeradas[origemIdx].origem
        });
        destinoIdx = rotasGeradas.length - 1;
    } else {
        destinoIdx = parseInt(destinoVal);
    }

    // Adiciona o pedido na rota de destino
    rotasGeradas[destinoIdx].pedidos.push(pedido);

    // 4. Recalcula as informações (Peso, Valor) das duas rotas
    recalcularRotaInfo(rotasGeradas[origemIdx]);
    recalcularRotaInfo(rotasGeradas[destinoIdx]);

    // 5. ATUALIZA A TELA E O MAPA
    mostrarResultados(); // Atualiza os Cards
    
    // Mantém a lista da rota de origem aberta para você continuar movendo
    window.toggleListaPedidos(origemIdx);
    
    // Desenha a rota de DESTINO no mapa para você ver onde o pedido foi parar
    // (Ou desenha a de origem se preferir ver o buraco que ficou)
    verRotaNoMapa(destinoIdx); 
    
    // Feedback visual rápido
    // alert(`Pedido movido para ${rotasGeradas[destinoIdx].rota_nome}`);
};

// 4. MESCLAR DUAS ROTAS
window.iniciarMesclagem = function(idxAlvo) {
    if (!verificarPermissaoEdicao(idxAlvo)) return;
    
    const input = prompt("Digite o NÚMERO da rota que você quer JUNTAR a esta (ex: 2 para Rota #2):");
    if (!input) return;
    
    // Tenta achar a rota pelo número visual (índice + 1)
    const idxOrigem = parseInt(input) - 1;
    
    if (isNaN(idxOrigem) || idxOrigem < 0 || idxOrigem >= rotasGeradas.length || idxOrigem === idxAlvo) {
        return alert("Número de rota inválido.");
    }
    
    if (rotasGeradas[idxOrigem].locked) return alert("A rota de origem está travada.");

    if(confirm(`Tem certeza que deseja mover todos os pedidos da "${rotasGeradas[idxOrigem].rota_nome}" para dentro da "${rotasGeradas[idxAlvo].rota_nome}"?`)) {
        // Move pedidos
        rotasGeradas[idxAlvo].pedidos.push(...rotasGeradas[idxOrigem].pedidos);
        
        // Remove a rota antiga
        rotasGeradas.splice(idxOrigem, 1);
        
        // Ajusta índice se necessário (se removeu uma rota anterior, o índice atual muda)
        const novoIdxAlvo = (idxOrigem < idxAlvo) ? idxAlvo - 1 : idxAlvo;
        
        recalcularRotaInfo(rotasGeradas[novoIdxAlvo]);
        mostrarResultados();
        verRotaNoMapa(novoIdxAlvo);
    }
};

// Helper de Segurança
function verificarPermissaoEdicao(rIdx) {
    if (rotasGeradas[rIdx].locked) {
        alert("Esta rota está travada para edições.");
        return false;
    }
    if (!currentUser.perm_editar && currentUser.role !== 'MASTER' && currentUser.role !== 'OPERADOR') {
        alert("Sem permissão para editar.");
        return false;
    }
    return true;
}

// =============================================================================
//                  LÓGICA DE DRAG & DROP (ARRASTAR E SOLTAR)
// =============================================================================

let draggedItemContext = null; 

// Inicia o arrasto
window.dragStart = function(e, rotaIdx, pedidoIdx) {
    draggedItemContext = { rotaIdx: rotaIdx, pedidoIdx: pedidoIdx };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(draggedItemContext));
    setTimeout(() => e.target.classList.add('dragging'), 0);
};

// Permite soltar
window.dragOver = function(e) {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = 'move';
};

// Solta o item e reordena
window.drop = function(e, targetRotaIdx, targetPedidoIdx) {
    e.preventDefault();
    
    // Limpa estilos
    document.querySelectorAll('.draggable-item').forEach(i => {
        i.classList.remove('dragging');
        i.classList.remove('drag-over');
    });

    if (!draggedItemContext || draggedItemContext.rotaIdx !== targetRotaIdx) return;

    const oldIndex = draggedItemContext.pedidoIdx;
    const newIndex = targetPedidoIdx;

    if (oldIndex === newIndex) return;

    // Troca no array
    const rota = rotasGeradas[targetRotaIdx];
    const itemMovido = rota.pedidos.splice(oldIndex, 1)[0];
    rota.pedidos.splice(newIndex, 0, itemMovido);

    draggedItemContext = null;

    // Atualiza Lista e Mapa
    renderizarListaPedidos(targetRotaIdx); 
    verRotaNoMapa(targetRotaIdx); 
};

// =============================================================================
//          FUNÇÃO: DAR ZOOM E DESTAQUE NO PINO (CLIQUE NA LISTA)
// =============================================================================
window.destacarPedidoNoMapa = function(rotaIdx, pedidoIdx) {
    
    // 1. Se a rota clicada não é a que está no mapa agora, desenha ela primeiro
    if (currentRouteIndex !== rotaIdx) {
        verRotaNoMapa(rotaIdx);
        // Pequeno delay para garantir que os marcadores foram criados antes de destacar
        setTimeout(() => aplicarDestaque(pedidoIdx), 300);
    } else {
        // Se já está na rota, destaca direto
        aplicarDestaque(pedidoIdx);
    }
};

function aplicarDestaque(index) {
    // Verifica se existem marcadores
    if (!markers || markers.length === 0) return;

    // 1. Limpa destaques anteriores (volta todos ao normal)
    markers.forEach(m => {
        const el = m.getElement();
        el.classList.remove('marker-highlight');
        el.style.zIndex = "1"; // Joga para trás
    });

    // 2. Pega o marcador alvo
    const alvo = markers[index];
    
    if (alvo) {
        const el = alvo.getElement();
        
        // Adiciona a classe CSS que deixa amarelo e grande
        el.classList.add('marker-highlight');
        el.style.zIndex = "9999"; // Joga para frente de tudo
        
        // Abre o balãozinho de informações se estiver fechado
        if (!alvo.getPopup().isOpen()) {
            alvo.togglePopup();
        }

        // Faz o mapa voar suavemente até lá
        map.flyTo({
            center: alvo.getLngLat(),
            zoom: 15, // Zoom bem próximo
            speed: 1.8, // Velocidade do voo
            curve: 1,
            essential: true
        });
    }
}

//

// =============================================================================
//              FUNÇÃO: SALVAR O TARGET (META) NO BANCO DE DADOS
// =============================================================================
window.salvarTarget = function() {
    const idOp = document.getElementById('selOperacaoCotacao').value;
    const valorInput = document.getElementById('quoteTarget').value;
    const valor = parseFloat(valorInput);
    
    if (!idOp) return alert("Selecione uma rota primeiro.");

    // Busca o documento da operação no histórico
    db.collection("historico").where("id_operacao", "==", idOp).get()
    .then(snap => {
        if (!snap.empty) {
            // Atualiza o campo 'target_price' no documento encontrado
            snap.docs[0].ref.update({ target_price: valor })
            .then(() => {
                // Feedback visual: Borda verde pisca para confirmar
                const input = document.getElementById('quoteTarget');
                input.style.borderBottom = "3px solid #198754"; // Verde
                setTimeout(() => input.style.borderBottom = "none", 1500);
            })
            .catch(err => alert("Erro ao salvar: " + err));
        }
    });
};