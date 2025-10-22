// /loja/frontend/script.js - FASE 1 e FASE 2

const API_URL = 'http://localhost:3000/api'; 

document.addEventListener('DOMContentLoaded', () => {
    carregarPacotes();

    const formPedido = document.getElementById('form-pedido');

    if (formPedido) {
        console.log("✅ Formulário encontrado! Anexando evento...");
        formPedido.addEventListener('submit', enviarPedidoTeste);
    } else {
        console.error("❌ ERRO CRÍTICO: Não encontrou o formulário com ID 'form-pedido'. Verifique o index.html!");
    }
});

// ... (Função carregarPacotes da FASE 1 - Inalterada) ...
async function carregarPacotes() {
    const container = document.getElementById('pacotes-container');
    container.innerHTML = 'Carregando pacotes...'; 

    try {
        const response = await fetch(`${API_URL}/pacotes`);
        const data = await response.json();
        
        container.innerHTML = '';
        
        data.categorias.forEach(categoria => {
            const categoriaElement = document.createElement('div');
            categoriaElement.className = 'bg-white p-6 rounded-lg shadow-xl hover:shadow-2xl transition duration-300';
            categoriaElement.innerHTML = `
                <h3 class="text-xl font-bold text-blue-600 mb-2">${categoria.nome}</h3>
                <p class="text-gray-600 mb-4">${categoria.descricao}</p>
                <div class="space-y-3">
                    ${categoria.pacotes.map(pacote => `
                        <div class="border-t pt-3 flex justify-between items-center">
                            <span class="font-medium">${pacote.nome}</span>
                            <span class="text-lg font-bold text-green-700">R$ ${pacote.preco.toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
            container.appendChild(categoriaElement);
        });

    } catch (error) {
        console.error('Erro ao carregar pacotes:', error);
        container.innerHTML = '<p class="text-red-600 col-span-full">Erro ao conectar com o backend. Verifique se o servidor Node.js está rodando (porta 3000).</p>';
    }
}


// -------------------------------------------------------------------------
// ✅ NOVA FUNÇÃO FASE 2: Simula o recebimento do webhook (apenas para testes)
// -------------------------------------------------------------------------
async function simularWebhook(pedidoId) {
    const statusDiv = document.getElementById('status-pedido');
    statusDiv.textContent = `Enviando simulação de Webhook para Pedido #${pedidoId}...`;
    
    try {
        const response = await fetch(`${API_URL}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                external_id: pedidoId, // Usado pelo backend para identificar
                status: 'aprovado', 
                valor_pago: 19.90
            })
        });
        
        if (response.ok) {
            statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-green-100 text-green-800';
            statusDiv.innerHTML += `<br>✅ **Webhook Enviado!** Status atualizado para 'Pago - Aguardando Envio'.`;
        } else {
            statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-red-100 text-red-800';
            statusDiv.innerHTML += `<br>❌ Erro ao simular Webhook: ${await response.text()}`;
        }
        
    } catch (error) {
        console.error('Erro na simulação do webhook:', error);
        statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-red-100 text-red-800';
        statusDiv.innerHTML += `<br>⚠️ Falha de rede na simulação do Webhook.`;
    }
}


// -------------------------------------------------------------------------
// ✅ NOVA FUNÇÃO FASE 2: Inicia a transação de pagamento (CORRIGIDA COM POLLING)
// -------------------------------------------------------------------------
async function iniciarPagamento(pedidoId) {
    const MODO_PRODUCAO = true; // PRECISA CORRESPONDER AO BACKEND!
    const modal = document.getElementById('modal-pix');
    const modalConteudo = document.getElementById('modal-pix-content');
    const statusDiv = document.getElementById('status-pedido');
    
    // Variável para armazenar o ID do pedido gerado (Date.now())
    let idDoPedido;

    statusDiv.textContent = `Iniciando pagamento para Pedido #${pedidoId}...`;
    statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-purple-100 text-purple-800';

    try {
        const response = await fetch(`${API_URL}/pagamento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedidoId: pedidoId, metodoPagamento: 'pix' })
        });
        
        const result = await response.json(); 

        if (!response.ok) {
            throw new Error(result.erro || 'Falha ao processar pagamento.');
        }
        
        // Armazena a ID do pedido para uso no Polling
        idDoPedido = result.pedidoId; 

        // 2. Montagem do HTML com os dados
        const htmlPix = `
            <h2 class="text-2xl font-bold mb-4 text-blue-600">Pagamento Pix</h2>
            <p class="mb-2 text-gray-700">Pedido ID: <strong>#${idDoPedido}</strong></p>
            <p class="mb-4 text-lg font-semibold text-green-700">Total: R$ ${result.valor.toFixed(2)}</p>
            
            <div class="flex flex-col items-center space-y-4">
                <img id="qrCodeImg" src="${result.qrCodeBase64}" alt="QR Code Pix" class="w-48 h-48 border-2 border-gray-300 p-2 rounded-lg">
                <p class="text-sm text-gray-500">Escaneie com o app do seu banco</p>
            </div>

            <div class="mt-6 border-t pt-4">
                <p class="font-medium mb-2">Pix Copia e Cola:</p>
                <div class="flex items-center space-x-2">
                    <input type="text" value="${result.pixCode}" readonly id="codigo-pix" class="flex-grow p-2 border rounded-lg text-sm bg-gray-50 font-mono">
                    <button onclick="document.execCommand('copy'); document.getElementById('status-pagamento-modal').textContent = 'Código Pix copiado!'; setTimeout(() => { document.getElementById('status-pagamento-modal').textContent = 'Aguardando pagamento...'; }, 2000);" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg text-sm transition">
                        Copiar
                    </button>
                </div>
            </div>
            <div id="status-pagamento-modal" class="mt-4 p-2 text-center text-sm bg-yellow-100 text-yellow-700 rounded-lg">
                Aguardando pagamento... (Verificando status a cada 5 segundos)
            </div>
        `;

        let botaoSimulacao = '';
        
        if (!MODO_PRODUCAO) {
            // Note: A função simularWebhook precisa ser definida globalmente ou passada aqui.
            // Para manter o código simples, vamos apenas exibir a mensagem no modo de simulação
            botaoSimulacao = `<p class="mt-5 text-center text-red-700 font-semibold">Modo de simulação ativo. Use o webhook manual.</p>`;
        } else {
            botaoSimulacao = `
                <p class="mt-5 text-center text-green-700 font-semibold">Aguardando confirmação de pagamento do seu Gateway...</p>`;
        }
        
        // 4. Exibe o modal
        modalConteudo.innerHTML = htmlPix + botaoSimulacao;
        modal.classList.remove('hidden');

        // -----------------------------------------------------------
        // 🚀 LÓGICA DE POLLING (CONSULTA AGENDADA)
        // -----------------------------------------------------------

        let intervalId = null; 

        const iniciarPolling = () => {
            if (intervalId) return; 

            intervalId = setInterval(async () => {
                try {
                    console.log(`[POLLING] Verificando status para Pedido ID: ${idDoPedido}`);
                    const responseStatus = await fetch(`${API_URL}/check-status/${idDoPedido}`);
                    const statusData = await responseStatus.json();

                    const modalStatusElement = document.getElementById('status-pagamento-modal');
                    
                    // 1. Atualiza o status de pagamento no modal (opcional)
                    if (modalStatusElement) {
                         modalStatusElement.textContent = `Status: ${statusData.status_envio} - Verificando a cada 5 segundos...`;
                         if(statusData.status_envio === 'Aguardando Pagamento') {
                             modalStatusElement.className = 'mt-4 p-2 text-center text-sm bg-yellow-100 text-yellow-700 rounded-lg';
                         } else if (statusData.status_envio === 'Enviado ao Fornecedor') {
                             modalStatusElement.className = 'mt-4 p-2 text-center text-sm bg-green-100 text-green-700 rounded-lg';
                         }
                    }

                    // 2. Condição de Sucesso para Redirecionamento
                    if (statusData.status_envio === 'Enviado ao Fornecedor') {
                        console.log(`[POLLING] ✅ Status CONFIRMADO! Redirecionando para a tela de sucesso...`);
                        
                        clearInterval(intervalId);
                        intervalId = null;

                        // Fecha o modal e redireciona para a tela de sucesso simples
                        modal.classList.add('hidden');
                        window.location.href = `sucesso.html?pedidoId=${idDoPedido}`;
                    }

                    // 3. Condição de Falha
                    if (statusData.status_envio === 'Falha no Envio SMM') {
                        clearInterval(intervalId);
                        intervalId = null;
                        modal.classList.add('hidden');
                        alert("Houve uma falha no envio do seu pedido. Contate o suporte."); // USAR MODAL CUSTOMIZADO
                    }

                } catch (error) {
                    console.error('[POLLING] Erro ao consultar status:', error);
                    // O Polling continua rodando, esperando o backend se recuperar
                }
            }, 5000); // Checa a cada 5 segundos
        };
        
        // Inicia o Polling após exibir o Pix
        iniciarPolling();
        
        // -----------------------------------------------------------
        
    } catch (error) {
        console.error('Erro de comunicação:', error);
        statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-red-100 text-red-800';
        statusDiv.textContent = `❌ ERRO no Pagamento: ${error.message}`;
        modal.classList.add('hidden');
    }
}

// Expondo a função para que o botão do modal possa chamá-la.
window.simularWebhook = simularWebhook;


// -------------------------------------------------------------------------
// Função de envio de Pedido (FASE 1 - MODIFICADA para chamar a FASE 2)
// -------------------------------------------------------------------------
async function enviarPedidoTeste(e) {
    e.preventDefault();
    
    const statusDiv = document.getElementById('status-pedido');
    statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-blue-100 text-blue-800';
    statusDiv.textContent = 'Enviando pedido para salvar no backend...';

    const link = document.getElementById('link').value;
    const pacoteId = document.getElementById('pacote-id').value;

    const pedidoData = {
        pacoteId: parseInt(pacoteId),
        link: link,
    };

    try {
        const response = await fetch(`${API_URL}/pedido`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pedidoData)
        });

        const result = await response.json();

        if (response.ok) {
            // Sucesso na FASE 1: Pedido Salvo. Agora inicia a FASE 2: Pagamento.
            document.getElementById('form-pedido').reset();
            await iniciarPagamento(result.pedidoId); // Chama a função de pagamento
            
        } else {
            statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-red-100 text-red-800';
            statusDiv.textContent = `❌ ERRO no Servidor (Salvando Pedido): ${result.erro || 'Erro desconhecido.'}`;
        }

    } catch (error) {
        console.error('Erro de comunicação:', error);
        statusDiv.className = 'mt-4 p-3 rounded-md text-sm bg-yellow-100 text-yellow-800';
        statusDiv.innerHTML = `⚠️ **FALHA DE CONEXÃO:** Verifique se o backend está ativo.`;
    }
}

// Expondo a função para o HTML poder chamá-la no botão
window.simularWebhook = simularWebhook;