const API_URL = '/api'; // 🚨 URL DEVE ESTAR AQUI!
const PEDIDOS_CONTAINER = document.getElementById('pedidos-container');

// Elementos de Configuração SMM
const configSmmForm = document.getElementById('config-smm-form');
const smmApiUrlInput = document.getElementById('smmApiUrl');
const smmApiKeyInput = document.getElementById('smmApiKey');
const smmMessageDiv = document.getElementById('smm-message');

// Elementos de Configuração de Pagamento
const configPagamentoForm = document.getElementById('config-pagamento-form');
const pagamentoMessageDiv = document.getElementById('pagamento-message');
const ppKeyInput = document.getElementById('ppKey');
const mpTokenInput = document.getElementById('mpToken');
const gatewayAtivoSelect = document.getElementById('gatewayAtivo');

// Elementos do Dashboard
const totalPedidosElement = document.getElementById('total-pedidos');
const totalFaturamentoElement = document.getElementById('total-faturamento');
const totalLucroElement = document.getElementById('total-lucro');
const smmBalanceElement = document.getElementById('smm-balance');
const saldoMessageElement = document.getElementById('saldo-message');

document.addEventListener('DOMContentLoaded', () => {
    // Inicializa o tema (claro/escuro)
    setupThemeToggle();
    // Inicializa a primeira aba
    showTab('dashboard'); 
    
    // Carrega dados iniciais do Dashboard (NOVO)
    carregarDadosDashboard();

    // Carrega os dados das abas
    carregarPedidos();
    loadSmmConfig();
    loadPaymentConfig();

    // Setup listeners
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (e) => showTab(e.target.dataset.tab));
    });
    
    configSmmForm.addEventListener('submit', handleSaveSmmConfig);
    configPagamentoForm.addEventListener('submit', handleSavePaymentConfig);
});

// -------------------------------------------------------------------------
// Lógica de Abas
// -------------------------------------------------------------------------
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`content-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
        button.classList.remove('border-blue-500', 'text-blue-500');
        button.classList.add('text-gray-500', 'hover:text-blue-500', 'border-transparent');
    });
    
    const activeTab = document.getElementById(`tab-${tabName}`);
    activeTab.classList.add('active', 'border-blue-500', 'text-blue-500');
    activeTab.classList.remove('text-gray-500', 'hover:text-blue-500', 'border-transparent');
}


// -------------------------------------------------------------------------
// Lógica de Tema Claro/Escuro (NOVO)
// -------------------------------------------------------------------------
function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    // Verifica a preferência salva no localStorage ou do sistema
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.classList.add('dark');
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
    }

    themeToggle.addEventListener('click', () => {
        if (document.documentElement.classList.contains('dark')) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        }
    });
}


// -------------------------------------------------------------------------
// Lógica do Dashboard (NOVO - Requer rotas no server.js)
// -------------------------------------------------------------------------
async function carregarDadosDashboard() {
    try {
        const response = await fetch(`${API_URL}/admin/dashboard-data`); // NOVA ROTA
        const data = await response.json();

        // Atualiza os cards
        totalPedidosElement.textContent = data.totalPedidos;
        totalFaturamentoElement.textContent = `R$ ${data.faturamento.toFixed(2)}`;
        totalLucroElement.textContent = `R$ ${data.lucro.toFixed(2)}`;
        
        // Simulação de Gráfico (Apenas para demonstração visual, Chart.js não está implementado aqui)
        console.log("Dados do Gráfico:", data.pedidosStatus);

    } catch (error) {
        console.error('Erro ao carregar dados do dashboard:', error);
        totalPedidosElement.textContent = 'Erro';
        totalFaturamentoElement.textContent = 'R$ 0,00';
    }
    carregarSaldo(); // Carrega o saldo logo após os dados principais
}


// -------------------------------------------------------------------------
// Lógica de Saldo SMM (NOVO - Requer rotas no server.js)
// -------------------------------------------------------------------------
window.carregarSaldo = async function() {
    smmBalanceElement.textContent = 'Checando...';
    saldoMessageElement.textContent = 'Aguarde...';

    try {
        const response = await fetch(`${API_URL}/admin/smm/check-balance`); // NOVA ROTA
        const result = await response.json();
        
        if (response.ok && result.success) {
            smmBalanceElement.textContent = `R$ ${parseFloat(result.balance).toFixed(2)}`;
            saldoMessageElement.className = 'mt-2 text-xs text-green-600 dark:text-green-400';
            saldoMessageElement.textContent = `Última checagem: ${new Date().toLocaleTimeString()}`;
        } else {
            smmBalanceElement.textContent = 'R$ ERRO';
            saldoMessageElement.className = 'mt-2 text-xs text-red-600 dark:text-red-400';
            saldoMessageElement.textContent = `Erro: ${result.message || 'Falha na comunicação.'}`;
        }

    } catch (error) {
        console.error('Erro ao checar saldo:', error);
        smmBalanceElement.textContent = 'R$ ERRO';
        saldoMessageElement.className = 'mt-2 text-xs text-red-600 dark:text-red-400';
        saldoMessageElement.textContent = 'Falha de rede ao checar saldo.';
    }
}


// -------------------------------------------------------------------------
// Lógica de Pedidos (ATUALIZADA)
// -------------------------------------------------------------------------
async function carregarPedidos() {
    PEDIDOS_CONTAINER.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-gray-500">Carregando pedidos...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/admin/pedidos`);
        const pedidos = await response.json();

        if (pedidos.length === 0) {
            PEDIDOS_CONTAINER.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhum pedido encontrado.</td></tr>';
            return;
        }

        PEDIDOS_CONTAINER.innerHTML = pedidos.map(pedido => {
            const statusPagamento = getStatusColor(pedido.status_pagamento);
            const statusSMM = getStatusColor(pedido.status_envio);
            
            return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition duration-150">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">${pedido.pedidoId}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">${pedido.pacote.nome}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">${pedido.link.substring(0, 30)}...</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600">R$ ${pedido.valor.toFixed(2)}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusPagamento}">
                            ${pedido.status_pagamento}
                        </span>
                    </td>
                    <td id="status-smm-${pedido.pedidoId}" class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusSMM}">
                            ${pedido.status_envio}
                        </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onclick="checarStatus(${pedido.pedidoId})" 
                                class="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-600 transition">
                            <i class="fas fa-sync-alt mr-1"></i> Checar Status
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
        PEDIDOS_CONTAINER.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-red-600">Erro ao conectar com o backend.</td></tr>';
    }
}

async function checarStatus(pedidoId) {
    const statusCell = document.getElementById(`status-smm-${pedidoId}`);
    const statusSpan = statusCell.querySelector('span');
    const originalText = statusSpan.textContent;
    
    statusSpan.textContent = 'Checando...';
    statusSpan.className = 'px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800';

    try {
        const response = await fetch(`${API_URL}/admin/checar-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedidoId })
        });
        
        const result = await response.json();
        
        if (response.ok && result.status_smm) {
            statusSpan.textContent = result.status_smm;
            statusSpan.className = getStatusColor(result.status_smm); // Aplica a nova cor/classe
        } else {
            // Se falhou mas retornou um status, exibe o status de erro
            statusSpan.textContent = (result.status_smm || 'Falha na API'); 
            statusSpan.className = getStatusColor('Falha'); 
        }

    } catch (error) {
        statusSpan.textContent = 'Rede Falhou';
        statusSpan.className = getStatusColor('Falha'); 
        console.error('Erro ao checar status:', error);
    }
}

function getStatusColor(status) {
    if (status.includes('Enviado') || status.includes('Em Processamento')) return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
    if (status.includes('Pago') || status.includes('Aprovado')) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    if (status.includes('Completo') || status.includes('Finalizado')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    if (status.includes('Aguardando') || status.includes('Pendente')) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    if (status.includes('Falha') || status.includes('Cancelado')) return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
}


// -------------------------------------------------------------------------
// Lógica de Gestão SMM (NOVO - Requer rotas no server.js)
// -------------------------------------------------------------------------

async function carregarServicosFornecedor() {
    const container = document.getElementById('smm-services-container');
    const messageDiv = document.getElementById('smm-services-message');
    
    container.innerHTML = '<p class="text-center py-4 text-blue-500"><i class="fas fa-spinner fa-spin mr-2"></i> Puxando serviços...</p>';
    messageDiv.classList.add('hidden');

    try {
        const response = await fetch(`${API_URL}/admin/smm/fetch-services`); // NOVA ROTA
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            messageDiv.textContent = `❌ Erro ao puxar serviços: ${result.message || 'Verifique sua URL e Chave API SMM.'}`;
            messageDiv.className = 'p-4 rounded-lg text-sm mb-4 bg-red-100 text-red-800';
            messageDiv.classList.remove('hidden');
            container.innerHTML = '';
            return;
        }

        messageDiv.textContent = `✅ ${result.services.length} serviços do fornecedor carregados. Configure-os abaixo.`;
        messageDiv.className = 'p-4 rounded-lg text-sm mb-4 bg-green-100 text-green-800';
        messageDiv.classList.remove('hidden');

        // Renderizar a tabela de serviços com campos de configuração
        container.innerHTML = renderServicesTable(result.services, result.pacotesAtuais);


    } catch (error) {
        console.error('Erro de rede ao buscar serviços SMM:', error);
        messageDiv.textContent = '⚠️ Falha de rede. Verifique se o backend está ativo e o CORS.';
        messageDiv.className = 'p-4 rounded-lg text-sm mb-4 bg-yellow-100 text-yellow-800';
        messageDiv.classList.remove('hidden');
        container.innerHTML = '';
    }
}

function renderServicesTable(services, pacotesAtuais) {
    // Cria um mapa para facilitar a busca de configurações atuais
    const pacotesMap = pacotesAtuais.reduce((acc, p) => {
        // Assume que o pacoteId é único e usamos ele como chave
        acc[p.servico_api_id] = p; 
        return acc;
    }, {});
    
    return `
        <form id="save-packages-form">
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                    <tr>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">ID Forn.</th>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">Nome Fornecedor</th>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">Preço Forn.</th>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">Nome na Loja</th>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">Preço Venda</th>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">Lucro (%)</th>
                        <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider">Ativo</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    ${services.map(service => {
                        const current = pacotesMap[service.service]; // Busca a config atual pelo ID da API
                        const isChecked = current ? 'checked' : '';
                        const nomeLoja = current ? current.nome : service.name;
                        const precoVenda = current ? current.preco : (service.rate * 2).toFixed(2); // Sugestão: 100% de lucro
                        const lucro = current ? ((current.preco - service.rate) / current.preco * 100).toFixed(0) : 50;
                        const categoria = current ? current.categoria : 'instagram'; // Placeholder para categoria
                        
                        return `
                            <tr class="dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition duration-150">
                                <td class="px-3 py-2 whitespace-nowrap text-xs">${service.service}</td>
                                <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${service.name}</td>
                                <td class="px-3 py-2 whitespace-nowrap text-sm text-red-500">R$ ${parseFloat(service.rate).toFixed(3)}</td>
                                
                                <input type="hidden" name="apiId_${service.service}" value="${service.service}">
                                <input type="hidden" name="apiRate_${service.service}" value="${service.rate}">
                                <input type="hidden" name="apiMin_${service.service}" value="${service.min}">
                                <input type="hidden" name="apiMax_${service.service}" value="${service.max}">

                                <td class="px-3 py-2"><input type="text" name="nome_${service.service}" value="${nomeLoja}" required class="w-full px-2 py-1 border rounded text-sm dark:bg-gray-700"></td>
                                
                                <td class="px-3 py-2"><input type="number" step="0.01" name="preco_${service.service}" value="${precoVenda}" required class="w-24 px-2 py-1 border rounded text-sm dark:bg-gray-700"></td>
                                
                                <td class="px-3 py-2"><input type="number" step="1" name="lucro_${service.service}" value="${lucro}" class="w-20 px-2 py-1 border rounded text-sm dark:bg-gray-700"></td>
                                
                                <td class="px-3 py-2 text-center">
                                    <input type="checkbox" name="ativo_${service.service}" ${isChecked} class="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
                                </td>
                                
                                <input type="hidden" name="categoriaId_${service.service}" value="${categoria}">
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <button type="submit" class="mt-6 py-3 px-6 rounded-lg text-lg font-bold text-white bg-green-600 hover:bg-green-700 transition duration-300">
            <i class="fas fa-save mr-2"></i> Salvar Configuração dos Pacotes na Loja
        </button>
        </form>
    `;
}

// NOVO: Função para lidar com o formulário de salvar pacotes (Requer rota no server.js)
document.addEventListener('submit', async (e) => {
    if (e.target.id === 'save-packages-form') {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const data = {};
        
        // Simples parser que agrupa os dados por serviceId
        const servicesData = {};
        for (let [key, value] of formData.entries()) {
            // Ex: key = nome_100, value = 100 Seguidores
            const parts = key.split('_');
            const field = parts[0];
            const serviceId = parts[1];
            
            if (!servicesData[serviceId]) {
                servicesData[serviceId] = {};
            }
            // Converte checkbox para boolean
            servicesData[serviceId][field] = (field === 'ativo' && value === 'on') ? true : value;
        }

        const pacotesParaSalvar = Object.values(servicesData).filter(s => s.ativo === true);
        
        const saveButton = form.querySelector('button[type="submit"]');
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Salvando...';

        try {
            const response = await fetch(`${API_URL}/admin/smm/save-packages`, { // NOVA ROTA
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pacotes: pacotesParaSalvar })
            });

            const result = await response.json();
            const messageDiv = document.getElementById('smm-services-message');

            if (response.ok && result.success) {
                messageDiv.textContent = `✅ Pacotes salvos com sucesso. ${result.count} pacotes ativos.`;
                messageDiv.className = 'p-4 rounded-lg text-sm mb-4 bg-green-100 text-green-800';
            } else {
                messageDiv.textContent = `❌ Erro ao salvar pacotes: ${result.message || 'Falha no servidor.'}`;
                messageDiv.className = 'p-4 rounded-lg text-sm mb-4 bg-red-100 text-red-800';
            }
            messageDiv.classList.remove('hidden');

        } catch (error) {
            console.error('Erro de rede ao salvar pacotes SMM:', error);
            const messageDiv = document.getElementById('smm-services-message');
            messageDiv.textContent = '⚠️ Falha de rede. Não foi possível salvar os pacotes.';
            messageDiv.className = 'p-4 rounded-lg text-sm mb-4 bg-yellow-100 text-yellow-800';
            messageDiv.classList.remove('hidden');
        } finally {
            saveButton.disabled = false;
            saveButton.innerHTML = '<i class="fas fa-save mr-2"></i> Salvar Configuração dos Pacotes na Loja';
            carregarPedidos(); // Atualiza a lista de pedidos após salvar
        }
    }
});


// -------------------------------------------------------------------------
// Lógica de Configurações SMM e Pagamento (A Lógica Antiga, Adaptada)
// -------------------------------------------------------------------------
// ... (Copiar e colar as funções loadSmmConfig, handleSaveSmmConfig, loadPaymentConfig, handleSavePaymentConfig do seu admin.js original) ...
// ... (Certifique-se de que a lógica de CORS e as rotas POST no server.js estão corretas!) ...

// Funções de Configuração SMM
async function loadSmmConfig() {
    try {
        const response = await fetch(`${API_URL}/admin/smm-config`);
        const config = await response.json();
        smmApiUrlInput.value = config.apiUrl || '';
        // smmApiKeyInput não deve ser preenchido por segurança
    } catch (error) {
        console.error('Erro ao carregar config SMM:', error);
    }
}

async function handleSaveSmmConfig(e) {
    e.preventDefault();
    const saveButton = document.getElementById('save-smm-button');
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Salvando...';
    
    const apiUrl = smmApiUrlInput.value;
    const apiKey = smmApiKeyInput.value;
    
    try {
        const response = await fetch(`${API_URL}/admin/config-smm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiUrl, apiKey })
        });

        const result = await response.json();

        if (response.ok) {
            smmMessageDiv.textContent = '✅ Configurações SMM salvas com sucesso.';
            smmMessageDiv.className = 'mt-4 p-3 rounded-lg text-sm font-medium bg-green-100 text-green-800';
            smmApiKeyInput.value = ''; // Limpa a chave por segurança
        } else {
            smmMessageDiv.textContent = `❌ Erro: ${result.error || 'Falha ao salvar.'}`;
            smmMessageDiv.className = 'mt-4 p-3 rounded-lg text-sm font-medium bg-red-100 text-red-800';
        }

    } catch (error) {
        smmMessageDiv.textContent = '⚠️ Falha de rede ao salvar configurações.';
        smmMessageDiv.className = 'mt-4 p-3 rounded-lg text-sm font-medium bg-yellow-100 text-yellow-800';
        console.error('Erro ao salvar config SMM:', error);
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = 'Salvar Configurações SMM';
        smmMessageDiv.classList.remove('hidden');
    }
}

// Funções de Configuração de Pagamento
async function loadPaymentConfig() {
    try {
        const response = await fetch(`${API_URL}/admin/pagamento-config`);
        const config = await response.json();
        
        gatewayAtivoSelect.value = config.gateway_ativo;
        // ppUrlInput.value = config.pushinpay.api_url; // Removido pois é fixo
        // mpTokenInput não deve ser preenchido por segurança
    } catch (error) {
        console.error('Erro ao carregar config Pagamento:', error);
    }
}

async function handleSavePaymentConfig(e) {
    e.preventDefault();
    const saveButton = document.getElementById('save-pagamento-button');
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Salvando...';
    
    const gatewayAtivo = gatewayAtivoSelect.value;
    const ppKey = ppKeyInput.value;
    const mpToken = mpTokenInput.value;
    
    try {
        const response = await fetch(`${API_URL}/admin/config-pagamento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gatewayAtivo, ppKey, mpToken })
        });

        const result = await response.json();

        if (response.ok) {
            pagamentoMessageDiv.textContent = `✅ Configurações de Pagamento salvas com sucesso. Gateway ativo: ${gatewayAtivo}`;
            pagamentoMessageDiv.className = 'mt-6 p-4 rounded-lg text-sm font-medium bg-green-100 text-green-800';
            ppKeyInput.value = ''; // Limpa as chaves por segurança
            mpTokenInput.value = '';
        } else {
            pagamentoMessageDiv.textContent = `❌ Erro: ${result.error || 'Falha ao salvar.'}`;
            pagamentoMessageDiv.className = 'mt-6 p-4 rounded-lg text-sm font-medium bg-red-100 text-red-800';
        }

    } catch (error) {
        pagamentoMessageDiv.textContent = '⚠️ Falha de rede ao salvar configurações.';
        pagamentoMessageDiv.className = 'mt-6 p-4 rounded-lg text-sm font-medium bg-yellow-100 text-yellow-800';
        console.error('Erro ao salvar config Pagamento:', error);
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = 'Salvar Configurações de Pagamento';
        pagamentoMessageDiv.classList.remove('hidden');
    }
}