const API_URL = 'https://newsmmpanel.onrender.com/api';
const PEDIDOS_CONTAINER = document.getElementById('pedidos-container');

// Elementos de Configuração SMM
const configSmmForm = document.getElementById('config-smm-form');
const smmApiUrlInput = document.getElementById('smmApiUrl');
const smmApiKeyInput = document.getElementById('smmApiKey');
const smmMessageDiv = document.getElementById('smm-message');

// Elementos de Configuração de Pagamento (NOVOS)
const configPagamentoForm = document.getElementById('config-pagamento-form');
const pagamentoMessageDiv = document.getElementById('pagamento-message');
const savePagamentoButton = document.getElementById('save-pagamento-button');
const ppUrlInput = document.getElementById('ppUrl');
const ppKeyInput = document.getElementById('ppKey');
const mpTokenInput = document.getElementById('mpToken');


document.addEventListener('DOMContentLoaded', () => {
    // Inicializa a primeira aba
    showTab('pedidos');
    // Carrega os dados
    carregarPedidos();
    
    // Setup listeners
    loadSmmConfig();
    configSmmForm.addEventListener('submit', handleSaveSmmConfig);
    
    loadPaymentConfig();
    configPagamentoForm.addEventListener('submit', handleSavePaymentConfig);
});

// -------------------------------------------------------------------------
// Lógica de Abas
// -------------------------------------------------------------------------
function showTab(tabName) {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        const isActive = button.getAttribute('data-tab') === tabName;
        button.classList.toggle('border-blue-500', isActive);
        button.classList.toggle('text-blue-600', isActive);
        button.classList.toggle('border-transparent', !isActive);
        button.classList.toggle('text-gray-500', !isActive);
    });

    tabContents.forEach(content => {
        // Mapeia o ID da aba para o ID do conteúdo
        const contentIdMap = {
            'pedidos': 'content-pedidos',
            'config-smm': 'content-config-smm',
            'config-pagamento': 'content-config-pagamento'
        };
        const isCurrent = content.id === contentIdMap[tabName];
        content.classList.toggle('hidden', !isCurrent);
    });

    if (tabName === 'config-smm') {
        loadSmmConfig();
    }
    if (tabName === 'config-pagamento') {
        loadPaymentConfig();
    }
}
window.showTab = showTab; // Torna a função acessível no HTML

// Função utilitária para exibir mensagens
const showMessage = (element, text, type = 'success') => {
    element.textContent = text;
    element.classList.remove('hidden', 'bg-red-100', 'text-red-800', 'bg-green-100', 'text-green-800');
    if (type === 'success') {
        element.classList.add('bg-green-100', 'text-green-800');
    } else {
        element.classList.add('bg-red-100', 'text-red-800');
    }
    setTimeout(() => {
        element.classList.add('hidden');
    }, 5000);
};

// -------------------------------------------------------------------------
// Lógica de Configuração SMM
// -------------------------------------------------------------------------
async function loadSmmConfig() {
    try {
        const response = await fetch(`${API_URL}/admin/config/smm`);
        if (!response.ok) {
            throw new Error('Falha ao carregar configurações do SMM.');
        }
        const config = await response.json();
        
        if (config.apiUrl) {
            smmApiUrlInput.value = config.apiUrl;
        }
        if (config.apiKeyExists) {
            smmApiKeyInput.placeholder = 'Chave API Salva (digite para ALTERAR)'; 
        } else {
            smmApiKeyInput.placeholder = 'Nenhuma chave API salva. Insira agora.';
        }

    } catch (error) {
        showMessage(smmMessageDiv, `Erro ao carregar configurações SMM: ${error.message}`, 'error');
    }
}

async function handleSaveSmmConfig(e) {
    e.preventDefault();
    const saveButton = document.getElementById('save-smm-button');
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando...';

    const newConfig = {
        apiUrl: smmApiUrlInput.value,
        apiKey: smmApiKeyInput.value,
    };
    
    if (!newConfig.apiKey) {
        delete newConfig.apiKey;
    }

    try {
        const response = await fetch(`${API_URL}/admin/config/smm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha desconhecida ao salvar.');
        }

        showMessage(smmMessageDiv, 'Configuração SMM salva com sucesso!');
        await loadSmmConfig(); 
        smmApiKeyInput.value = ''; 

    } catch (error) {
        showMessage(smmMessageDiv, `Erro ao salvar: ${error.message}`, 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Salvar Configuração SMM';
    }
}

// -------------------------------------------------------------------------
// Lógica de Configuração de Pagamento (NOVA)
// -------------------------------------------------------------------------
async function loadPaymentConfig() {
    try {
        const response = await fetch(`${API_URL}/admin/config/pagamento`);
        if (!response.ok) {
            throw new Error('Falha ao carregar configurações de pagamento.');
        }
        const config = await response.json();
        
        // 1. Gateway Ativo
        const activeRadio = document.querySelector(`input[name="gatewayAtivo"][value="${config.gatewayAtivo}"]`);
        if (activeRadio) {
            activeRadio.checked = true;
        }

        // 2. PushinPay
        ppUrlInput.value = config.pushinpay.apiUrl || '';
        if (config.pushinpay.apiKeyExists) {
            ppKeyInput.placeholder = 'Chave API Salva (digite para ALTERAR)'; 
        } else {
            ppKeyInput.placeholder = 'Nenhuma chave PushinPay salva. Insira agora.';
        }
        
        // 3. Mercado Pago
        if (config.mercadopago.accessTokenExists) {
            mpTokenInput.placeholder = 'Access Token Salvo (digite para ALTERAR)'; 
        } else {
            mpTokenInput.placeholder = 'Nenhum Access Token MP salvo. Insira agora.';
        }


    } catch (error) {
        showMessage(pagamentoMessageDiv, `Erro ao carregar configurações de pagamento: ${error.message}`, 'error');
    }
}

async function handleSavePaymentConfig(e) {
    e.preventDefault();
    savePagamentoButton.disabled = true;
    savePagamentoButton.textContent = 'Salvando...';

    const gatewayAtivo = document.querySelector('input[name="gatewayAtivo"]:checked').value;

    const newConfig = {
        gatewayAtivo: gatewayAtivo,
        ppUrl: ppUrlInput.value,
        ppKey: ppKeyInput.value,
        mpToken: mpTokenInput.value
    };
    
    // Regras de validação
    if (gatewayAtivo === 'PushinPay' && (!newConfig.ppUrl || (!newConfig.ppKey && ppKeyInput.placeholder.includes('Nenhuma chave')))) {
        savePagamentoButton.disabled = false;
        savePagamentoButton.textContent = 'Salvar Configurações de Pagamento';
        return showMessage(pagamentoMessageDiv, 'URL e Chave PushinPay são obrigatórias para ativar.', 'error');
    }
    if (gatewayAtivo === 'MercadoPago' && (!newConfig.mpToken && mpTokenInput.placeholder.includes('Nenhum Access Token'))) {
         savePagamentoButton.disabled = false;
         savePagamentoButton.textContent = 'Salvar Configurações de Pagamento';
         return showMessage(pagamentoMessageDiv, 'Access Token do Mercado Pago é obrigatório para ativar.', 'error');
    }


    try {
        const response = await fetch(`${API_URL}/admin/config/pagamento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha desconhecida ao salvar.');
        }

        showMessage(pagamentoMessageDiv, 'Configurações de Pagamento salvas com sucesso!');
        await loadPaymentConfig(); 
        ppKeyInput.value = ''; // Limpa as chaves sensíveis após salvar
        mpTokenInput.value = '';

    } catch (error) {
        showMessage(pagamentoMessageDiv, `Erro ao salvar: ${error.message}`, 'error');
    } finally {
        savePagamentoButton.disabled = false;
        savePagamentoButton.textContent = 'Salvar Configurações de Pagamento';
    }
}


// -------------------------------------------------------------------------
// Funções de Pedidos (Mantidas do seu código original)
// -------------------------------------------------------------------------
// NOTA: Estas funções devem estar no final do seu admin.js
async function carregarPedidos() {
    PEDIDOS_CONTAINER.innerHTML = '<p class="text-center text-gray-500">Carregando pedidos...</p>';

    try {
        const response = await fetch(`${API_URL}/admin/pedidos`);
        const pedidos = await response.json();

        if (pedidos.length === 0) {
            PEDIDOS_CONTAINER.innerHTML = '<p class="text-center text-gray-500">Nenhum pedido encontrado.</p>';
            return;
        }

        let tableHtml = `
            <table class="min-w-full bg-white shadow-lg rounded-lg overflow-hidden">
                <thead class="bg-gray-200">
                    <tr>
                        <th class="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase">ID Local</th>
                        <th class="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase">Data/Hora</th>
                        <th class="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase">Link</th>
                        <th class="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase">Status Loja</th>
                        <th class="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase">ID SMM</th>
                        <th class="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase">Status SMM</th>
                        <th class="py-3 px-4 text-center text-xs font-medium text-gray-600 uppercase">Ação</th>
                    </tr>
                </thead>
                <tbody>
        `;

        pedidos.forEach(pedido => {
            const date = new Date(pedido.data).toLocaleString('pt-BR');
            const statusColor = getStatusColor(pedido.status);

            tableHtml += `
                <tr class="border-t hover:bg-gray-50">
                    <td class="py-3 px-4 text-sm font-bold text-gray-700">${pedido.id}</td>
                    <td class="py-3 px-4 text-xs text-gray-500">${date}</td>
                    <td class="py-3 px-4 text-xs text-blue-500 truncate max-w-xs">${pedido.link}</td>
                    <td class="py-3 px-4 text-sm">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">
                            ${pedido.status}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-xs font-mono">${pedido.api_id || 'N/A'}</td>
                    <td id="status-smm-${pedido.id}" class="py-3 px-4 text-xs text-orange-600 font-semibold">${pedido.api_status || 'N/A'}</td>
                    <td class="py-3 px-4 text-center">
                        <button 
                            onclick="checarStatus(${pedido.id})" 
                            class="bg-blue-500 hover:bg-blue-700 text-white text-xs font-bold py-1 px-2 rounded disabled:opacity-50"
                            ${!pedido.api_id ? 'disabled' : ''}>
                            Checar SMM
                        </button>
                    </td>
                </tr>
            `;
        });

        tableHtml += `</tbody></table>`;
        PEDIDOS_CONTAINER.innerHTML = tableHtml;

    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
        PEDIDOS_CONTAINER.innerHTML = '<p class="text-red-600 text-center">Erro ao conectar com o backend ou JSON de pedidos inválido.</p>';
    }
}

async function checarStatus(pedidoId) {
    const statusCell = document.getElementById(`status-smm-${pedidoId}`);
    const originalText = statusCell.textContent;
    statusCell.textContent = 'Checando...';

    try {
        const response = await fetch(`${API_URL}/admin/checar-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedidoId })
        });
        
        const result = await response.json();
        
        if (response.ok && result.status_smm) {
            statusCell.textContent = result.status_smm;
        } else {
            statusCell.textContent = originalText + ' (Erro: ' + (result.status_smm || 'Falha') + ')';
        }

    } catch (error) {
        statusCell.textContent = originalText + ' (Rede falhou)';
        console.error('Erro ao checar status:', error);
    }
}

function getStatusColor(status) {
    if (status.includes('Enviado')) return 'bg-purple-100 text-purple-800';
    if (status.includes('Pago')) return 'bg-green-100 text-green-800';
    if (status.includes('Pendente')) return 'bg-yellow-100 text-yellow-800';
    if (status.includes('Falha')) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
}

window.checarStatus = checarStatus;
