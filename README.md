Roteirizador & Portal de Cargas - Fotus
1. Visão Geral
O projeto consiste em uma plataforma web completa para gestão logística, dividida em dois ambientes principais: o Painel Administrativo (Roteirizador), focado em inteligência logística e otimização de cargas, e o Portal do Transportador,
focado na negociação de fretes e captação de ofertas.
O sistema elimina o uso de planilhas manuais desconectadas, centralizando a operação em nuvem com cálculo automático de custos, visualização geográfica e automação de comunicação.
________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________
2. Stack Tecnológico (Tecnologias Utilizadas)
O projeto foi construído utilizando uma arquitetura Serverless (sem servidor dedicado), garantindo baixo custo inicial e alta escalabilidade.
•	Frontend: HTML5, CSS3 (Bootstrap 5), JavaScript (Vanilla ES6+).
•	Mapas & Geoespacial: Mapbox GL JS (Visualização), Turf.js (Cálculos de raio, distância e polígonos).
•	Backend & Banco de Dados: Google Firebase (Firestore Database & Authentication).
•	Hospedagem: Netlify (Deploy Contínuo).
•	Manipulação de Arquivos: SheetJS (Importação Excel), jsPDF (Geração de Manifestos).
•	Automação & Integração: Zapier (Gatilhos e Disparos de Notificação).
________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________
3. Módulos do Sistema
🏢 Módulo A: Roteirizador (Painel Administrativo)
Ambiente seguro para a equipe de logística.
•	Login Seguro: Autenticação via Firebase Auth (E-mail corporativo e Senha).
•	Importação Inteligente: Leitura automática de planilhas de pedidos (Excel/CSV) com geocodificação de endereços.
•	Motor de Roteirização: Algoritmo que agrupa pedidos por proximidade e UF, respeitando a capacidade dos veículos (Truck vs. Carreta).
•	Painel Financeiro (Comparativo):
o	Calcula automaticamente o custo Itinerante (Dedicado) baseada em Km rodado.
o	Compara com tabelas de Fracionado cadastradas.
o	Indica visualmente a opção mais econômica ("Winner").
•	Visualização: Mapa interativo com traçado de rotas, marcação de clientes e alertas de áreas de risco.
•	Gestão de Dados: Backup de rotas no histórico e exportação de relatórios gerenciais.
🚛 Módulo B: Portal do Transportador (Mural de Cargas)
Ambiente público/externo acessível via link (Mobile Friendly).
•	Mural de Vagas: Listagem das cargas disponíveis com filtros visuais (cards modernos).
•	Detalhes da Rota:
o	Visualização "Timeline" (Linha do tempo) mostrando Origem -> Sequência de Entregas.
o	Botão "Ver Trajeto" que abre a rota direto no aplicativo Google Maps do motorista.
•	Sistema de Cotação (Bidding):
o	Formulário para envio de lances (Valor e Prazo).
o	Captura de Leads: Ao enviar uma proposta, o sistema salva/atualiza automaticamente o contato do motorista (WhatsApp/E-mail) para criar um banco de dados de parceiros.
________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________
4. Fluxo de Automação (Workflow Atual)
Implementamos uma automação "Event-Driven" (baseada em eventos) utilizando o Zapier:
1.	Gatilho: O analista clica em "Salvar Rota" no Painel Administrativo.
2.	Processamento: O Firebase grava os dados da operação no banco de dados.
3.	Automação: O Zapier detecta o novo documento em tempo real.
4.	Ação: O sistema dispara automaticamente um e-mail de notificação contendo:
o	Resumo da carga (Veículo, Destino).
o	Link Único que leva direto para a tela de cotação daquela rota específica.
________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________
5. Status Atual do Projeto
✅ Infraestrutura: Configurada e rodando no Netlify + Firebase.
✅ Roteirização: 100% funcional (Importação, Mapa, Cálculo de Custo).
✅ Portal do Motorista: 100% funcional (Visualização de Rota, Envio de Oferta e Cadastro Automático).
✅ Automação: Teste validado via Zapier (Disparo de E-mail via Gmail).
________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________
Próximos Passos e Atualizações
1.	Automação de WhatsApp: Substituir/Adicionar ao e-mail o envio via WhatsApp (usando Twilio ou WATI) para aumentar a taxa de resposta dos motoristas.
2.	Status da Cotação: Permitir que o Admin "Aprove" ou "Rejeite" uma oferta, notificando o motorista ganhador automaticamente.
3.	Target Alvo: Campo no Mural de Ofertas com um valor de Target do Frete já definido.
4.	Aviso de Descarga: Inserir uma observação de “Descarga Inclusa” em todas as Rotas Disponíveis no Mural de Ofertas.
