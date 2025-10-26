const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); 
const { initMPClient, criarPagamentoPixMP } = require('./mercadopago');

const app = express();
// No Render/Railway, a porta é fornecida pelo ambiente (process.env.PORT)
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(cors());

// -------------------------------------------------------------------------
// Configuração para Servir a Pasta Frontend (MUITO IMPORTANTE)
// -------------------------------------------------------------------------
// Este caminho assume que server.js está em /backend e frontend em /frontend
const frontendPath = path.join(__dirname, '..', 'frontend'); 
console.log(`Servindo arquivos estáticos de: ${frontendPath}`);
app.use(express.static(frontendPath));

// Caminhos para os arquivos JSON de dados
const PEDIDOS_PATH = path.join(__dirname, '..', 'data', 'pedidos.json');
const PACOTES_PATH = path.join(__dirname, '..', 'data', 'pacotes.json');
const CONFIGURACOES_PATH = path.join(__dirname, '..', 'data', 'configuracoes.json');

// -------------------------------------------------------------------------
// Função Utilitária para Carregar Configurações (CRUCIAL!)
// -------------------------------------------------------------------------
async function loadConfig() {
    try {
        const configsData = await fs.readFile(CONFIGURACOES_PATH, 'utf-8'); //
        let configs = JSON.parse(configsData);
        
        // NOVO: Inicializa o cliente Mercado Pago ao carregar a config (se houver token)
        if (configs.mercadopago && configs.mercadopago.access_token) { //
            initMPClient(configs.mercadopago.access_token);
        }
        
        return configs;
    } catch (error) {
        console.error('Erro fatal ao carregar configuracoes.json:', error);
        return { modo: 'simulacao', pagamento: { pushinpay: { modo_real: {}, modo_simulacao: {} } }, fornecedor_smm: {} }; 
    }
}

// -------------------------------------------------------------------------
// FASE 3: Função para Enviar o Pedido à API do Fornecedor (HÍBRIDA)
// -------------------------------------------------------------------------
async function enviarParaFornecedor(pedido) {
    const config = await loadConfig();
    const FORNECEDOR_CONFIG = config.fornecedor_smm; //
    const MODO_PRODUCAO = config.modo === 'real';

    if (MODO_PRODUCAO) {
        // --- MODO DE PRODUÇÃO (CHAMADA REAL) ---
        console.log(`[PROD-SMM] Tentando enviar pedido ID ${pedido.id} REALMENTE para o fornecedor...`);
        try {
            // No seu código, o ID e quantidade SMM estão fixos na config.
            // O correto seria usar pedido.pacote.servico_api_id e a quantidade do pedido.
            // Para manter a lógica ATUAL, vamos usar o fixo, mas ajustamos o SMM no Front-end:
            const serviceId = pedido.pacote.servico_api_id || FORNECEDOR_CONFIG.servico_padrao; 
            const quantity = pedido.quantidade || FORNECEDOR_CONFIG.quantidade_padrao;

            const smmPayload = {
                key: FORNECEDOR_CONFIG.api_key,
                action: 'add', 
                service: serviceId,
                link: pedido.link,
                quantity: quantity
            };

            const response = await axios.post(FORNECEDOR_CONFIG.api_url, smmPayload);
            const responseData = response.data;
            
            if (responseData.error) {
                 throw new Error(`Erro API SMM: ${responseData.error}`);
            }

            const smmOrderId = responseData.order; 
            
            return { api_id: smmOrderId, api_status: 'Processing' };

        } catch (error) {
            console.error(`[PROD-SMM] ERRO ao comunicar com fornecedor REAL:`, error.message);
            return { api_id: null, api_status: 'Falha no Envio SMM' };
        }
    } else {
        // --- MODO DE SIMULAÇÃO ---
        console.log(`[SIMULAÇÃO-SMM] Enviando pedido ID ${pedido.id} (simulado)...`);
        const smmOrderId = `SMM-${pedido.id}-${Math.floor(Math.random() * 1000)}`;
        return {
            api_id: smmOrderId,
            api_status: 'Processing (Simulated)' 
        };
    }
}


// -------------------------------------------------------------------------
// NOVAS FUNÇÕES UTILITÁRIAS PARA O ADMIN
// -------------------------------------------------------------------------

/**
 * @description Checa o saldo real do fornecedor SMM.
 */
async function checkSmmBalance(smmConfig) {
    try {
        const payload = {
            key: smmConfig.api_key,
            action: 'balance'
        };

        const response = await axios.post(smmConfig.api_url, payload);
        const data = response.data;

        if (data.error) {
            throw new Error(`Erro API SMM: ${data.error}`);
        }
        
        // Retorna o saldo (o nome da chave é 'balance' na maioria das APIs SMM)
        return parseFloat(data.balance); 

    } catch (error) {
        console.error('[SMM-BALANCE] Erro ao buscar saldo:', error.message);
        throw new Error('Falha ao comunicar com a API SMM para checar saldo.');
    }
}

/**
 * @description Puxa a lista de serviços do fornecedor SMM.
 */
async function fetchSmmServices(smmConfig) {
    try {
        const payload = {
            key: smmConfig.api_key,
            action: 'services'
        };

        const response = await axios.post(smmConfig.api_url, payload);
        const data = response.data;

        if (data.error) {
            throw new Error(`Erro API SMM: ${data.error}`);
        }
        
        // O retorno esperado é um array de objetos [ {service: '...', name: '...', rate: '...'}, ... ]
        return data; 

    } catch (error) {
        console.error('[SMM-SERVICES] Erro ao buscar serviços:', error.message);
        throw new Error('Falha ao comunicar com a API SMM para buscar serviços.');
    }
}

/**
 * @description Checa o status de um pedido na API SMM.
 */
async function checkSmmStatus(smmConfig, orderId) {
    try {
        const payload = {
            key: smmConfig.api_key,
            action: 'status',
            order: orderId
        };

        const response = await axios.post(smmConfig.api_url, payload);
        const data = response.data;

        if (data.error) {
            throw new Error(`Erro API SMM: ${data.error}`);
        }
        
        // Retorna o status (geralmente data.status ou data.order)
        // Tentativa de padronizar o retorno
        const statusKey = Object.keys(data).find(key => key.toLowerCase().includes('status'));
        
        if (statusKey) {
            return data[statusKey];
        }
        
        // Se a API retornar só o status no root ou outro formato comum
        return data.status || data.order; 

    } catch (error) {
        console.error('[SMM-STATUS] Erro ao checar status:', error.message);
        throw new Error('Falha ao comunicar com a API SMM para checar status.');
    }
}


// -------------------------------------------------------------------------
// Rota para obter os pacotes
// -------------------------------------------------------------------------
app.get('/api/pacotes', async (req, res) => {
    try {
        const data = await fs.readFile(PACOTES_PATH, 'utf-8'); //
        const pacotes = JSON.parse(data);
        res.json(pacotes);
    } catch (error) {
        console.error('Erro ao ler pacotes.json:', error);
        res.status(500).json({ erro: 'Não foi possível carregar os pacotes.' });
    }
});


// -------------------------------------------------------------------------
// Rota para receber pedido (Primeira etapa do checkout)
// -------------------------------------------------------------------------
// ... (Lógica POST /api/pedido inalterada) ...
app.post('/api/pedido', async (req, res) => {
    const novoPedido = req.body; 

    if (!novoPedido.pacoteId || !novoPedido.link) {
        return res.status(400).json({ erro: 'Dados do pedido incompletos.' });
    }

    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = [];
        if (pedidosData && pedidosData.trim().length > 0) {
            pedidos = JSON.parse(pedidosData);
        }
        
        // Lógica para encontrar o pacote [NOVO: Necessário para o valor e ID SMM]
        const pacotesData = await fs.readFile(PACOTES_PATH, 'utf-8'); //
        const pacotesJson = JSON.parse(pacotesData);
        let pacoteEncontrado = null;
        
        pacotesJson.categorias.forEach(categoria => {
            const encontrado = categoria.pacotes.find(p => p.id === parseInt(novoPedido.pacoteId));
            if (encontrado) pacoteEncontrado = encontrado;
        });

        if (!pacoteEncontrado) {
             return res.status(404).json({ erro: 'Pacote não encontrado.' });
        }


        const pedidoCompleto = {
            id: Date.now(), 
            ...novoPedido,
            pacote: pacoteEncontrado, // Salva os dados completos do pacote
            valor: pacoteEncontrado.preco, // O valor real do pacote vendido
            data: new Date().toISOString(),
            status: 'Pendente Pagamento',
            api_status: null, 
            api_id: null, 
            pagamento: {
                status: 'Aguardando',
                metodo: null,
                gateway: null, 
                qr_code_base64: null, 
                pix_code: null,      
                external_id: null
            }
        };

        pedidos.push(pedidoCompleto);
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        res.status(201).json({ 
            mensagem: 'Pedido recebido com sucesso!', 
            pedidoId: pedidoCompleto.id,
            status: pedidoCompleto.status 
        });

    } catch (error) {
        console.error('Erro ao processar o pedido:', error); 
        res.status(500).json({ erro: 'Erro interno ao salvar o pedido.' }); 
    }
});


// -------------------------------------------------------------------------
// ROTA MODIFICADA: Iniciar Pagamento (Centralizada MP e PP)
// -------------------------------------------------------------------------
// ... (Lógica POST /api/pagamento inalterada, exceto que o valor agora vem do pedido) ...
app.post('/api/pagamento', async (req, res) => {
    const { pedidoId, metodoPagamento } = req.body;

    if (!pedidoId || metodoPagamento !== 'pix') {
        return res.status(400).json({ erro: 'Dados de pagamento incompletos ou método inválido.' });
    }

    try {
        const configs = await loadConfig(); // Carrega a config para saber o gateway ativo
        const gatewayAtivo = configs.gateway_ativo || 'PushinPay';
        const MODO_PRODUCAO = configs.modo === 'real';

        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        const pedidoIndex = pedidos.findIndex(p => p.id === parseInt(pedidoId));

        if (pedidoIndex === -1) {
            return res.status(404).json({ erro: 'Pedido não encontrado.' });
        }

        const pedido = pedidos[pedidoIndex];
        // ⚠️ USANDO O VALOR REAL DO PACOTE NO PEDIDO, NÃO O VALOR PADRÃO DA CONFIG
        const valor = pedido.pacote.preco; 
        
        let qrCodePix;
        let codigoPixCopiaCola;
        let externalIdGateway;
        let gatewayUsado = gatewayAtivo; 

        if (gatewayAtivo === 'PushinPay') {
            // ... (Lógica PushinPay inalterada) ...
            
            const ppConfig = configs.pushinpay; //
            if (!ppConfig || !ppConfig.api_key || !ppConfig.api_url) {
                 throw new Error('PushinPay não configurado no painel admin.');
            }
            
            const ppConfigOld = MODO_PRODUCAO 
                ? configs.pagamento.pushinpay.modo_real 
                : configs.pagamento.pushinpay.modo_simulacao;

            if (MODO_PRODUCAO) {
                 // --- MODO DE PRODUÇÃO (CHAMADA REAL PUSHINPAY) ---
                const valorEmCentavos = Math.round(valor * 100); 
                
                try {
                    const paymentPayload = {
                        value: valorEmCentavos,
                        webhook_url: ppConfigOld.webhook_url, 
                        external_id: String(pedido.id) 
                    };
                    
                    const response = await axios.post(ppConfig.api_url, paymentPayload, {
                        headers: { 
                            'Authorization': `Bearer ${ppConfig.api_key}`, //
                            'Content-Type': 'application/json' 
                        }
                    });

                    const paymentData = response.data;
                    
                    console.log('✅ DADOS BRUTOS DA PUSHINPAY (SUCESSO):', paymentData);

                    qrCodePix = paymentData.qr_code_base64; 
                    codigoPixCopiaCola = paymentData.qr_code; 
                    externalIdGateway = paymentData.id; 

                } catch (error) {
                    const errorMessage = error.response ? (error.response.data || error.response.statusText) : error.message;
                    console.error('❌ ERRO REAL ao chamar API PushinPay:', errorMessage);
                    
                    qrCodePix = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0BMVEX/AP+AgAAAX7dI9QAAAUJJREFUeNpjYACAAgAAADsAASaY2yYAAAAASUVORK5CYII=`; 
                    codigoPixCopiaCola = 'FALHA DE COMUNICAÇÃO COM PUSHINPAY. Verifique o console do backend.';
                    externalIdGateway = `ERRO_GATEWAY_${pedidoId}`;
                }
            } else {
                // --- MODO DE SIMULAÇÃO ---
                qrCodePix = `data:image/png;base64,SIMULACAO_QR_CODE_${pedidoId}`;
                codigoPixCopiaCola = `SIMULACAO_PIX_COPIA_E_COLA_${pedidoId}_VALOR_${valor}`;
                externalIdGateway = `SIM_GATEWAY_${pedidoId}`;
            }

        } else if (gatewayAtivo === 'MercadoPago') {
             // --- LÓGICA MERCADO PAGO (NOVO) ---
             const mpToken = configs.mercadopago?.access_token;
             if (!mpToken) {
                 throw new Error('Mercado Pago não configurado no painel admin.');
             }
             
             const mpResponse = await criarPagamentoPixMP(
                 valor,
                 `Pedido #${pedidoId} de Serviço SMM`,
                 pedido.email || 'cliente@lojasmm.com', 
                 pedidoId.toString()
             );
             
             qrCodePix = mpResponse.qrCodeBase64;
             codigoPixCopiaCola = mpResponse.pixCode;
             externalIdGateway = mpResponse.id; 

        } else {
             throw new Error('Gateway de pagamento ativo não suportado.');
        }

        // 2. Atualiza o status do pagamento no pedido
        pedido.pagamento = {
            status: 'Aguardando Pagamento',
            metodo: metodoPagamento,
            gateway: gatewayUsado, 
            valor: valor,
            qr_code_base64: qrCodePix,
            pix_code: codigoPixCopiaCola,
            external_id: externalIdGateway, 
            expiracao: new Date(Date.now() + 3600000).toISOString()
        };
        pedido.status = 'Aguardando Pagamento'; 

        // 3. Salva a atualização
        pedidos[pedidoIndex] = pedido;
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        console.log(`[PAGAMENTO] ✅ Pix ID ${pedido.id} gerado via ${gatewayUsado}. EXTERNAL ID SALVO: ${pedido.pagamento.external_id}`);
        
        // 4. Retorna a resposta COMPLETA ao Frontend (Chaves padronizadas)
        res.status(200).json({
            mensagem: 'Pagamento iniciado com sucesso.',
            pedidoId: pedido.id,
            gateway: gatewayUsado, 
            qrCodeBase64: qrCodePix,
            pixCode: codigoPixCopiaCola,
            valor: valor,
            status: pedido.status
        });

    } catch (error) {
        console.error('Erro ao iniciar pagamento:', error);
        res.status(500).json({ erro: error.message || 'Erro interno ao processar o pagamento.' });
    }
});
// ... (Rotas de Webhook Inalteradas) ...

// -------------------------------------------------------------------------
// Endpoint de Webhook (Recebe confirmação da PushinPay e ENVIA AO SMM)
// -------------------------------------------------------------------------
app.post('/api/webhook', async (req, res) => {
    
    const webhookData = req.body || {};
    
    // ... (Lógica de Webhook PushinPay inalterada) ...
    console.log('[WEBHOOK-PP] REQUEST RECEBIDO.');
    console.log('[WEBHOOK-PP] Dados Recebidos (req.body):', webhookData);
    
    const rawGatewayId = webhookData.external_id || webhookData.id; 
    
    const gatewayIdParaBusca = rawGatewayId ? rawGatewayId.toLowerCase() : null;
    
    const statusPagamento = webhookData.status || webhookData.status_pagamento; 

    if (!gatewayIdParaBusca) {
          console.warn('[WEBHOOK-PP] Webhook recebido, mas sem ID de gateway válido. Ignorado.');
          return res.status(200).send('Webhook recebido, mas sem ID de gateway válido.');
    }
    
    const statusAprovado = ['APPROVED', 'CONFIRMED', 'PAID'];
    if (!statusPagamento || !statusAprovado.includes(statusPagamento.toUpperCase())) {
        console.log(`[WEBHOOK-PP] Status de pagamento para ID ${gatewayIdParaBusca} não aprovado: ${statusPagamento}. Ignorado.`);
        return res.status(200).send(`Pagamento status: ${statusPagamento}. Ignorado.`);
    }

    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        
        const pedidoIndex = pedidos.findIndex(p => 
            p.pagamento && p.pagamento.external_id && p.pagamento.external_id.toLowerCase() === gatewayIdParaBusca
        ); 

        if (pedidoIndex === -1) {
            console.warn(`[WEBHOOK-PP] Pedido não encontrado no arquivo local com o Gateway ID (Busca): ${gatewayIdParaBusca}.`);
            return res.status(404).send('Pedido não encontrado para o webhook.');
        }
        
        const pedido = pedidos[pedidoIndex];
        
        if (pedido.status === 'Enviado ao Fornecedor' || pedido.status.includes('Falha no Envio')) {
            return res.status(200).send('Pagamento e Envio já processados.');
        }

        // 1. Confirmação do Pagamento
        pedido.pagamento.status = 'Confirmado';
        pedido.pagamento.dataConfirmacao = new Date().toISOString();
        console.log(`[PUSHINPAY] Pagamento CONFIRMADO para Pedido ID ${pedido.id}.`);

        // 2. 🚀 CHAMA A FUNÇÃO DE ENVIO AO FORNECEDOR
        const smmResult = await enviarParaFornecedor(pedido);
        
        // 3. Atualiza o status geral e as IDs do fornecedor
        pedido.api_id = smmResult.api_id;
        pedido.api_status = smmResult.api_status;
        pedido.status = smmResult.api_id ? 'Enviado ao Fornecedor' : 'Falha no Envio SMM';

        // 4. Salva a atualização
        pedidos[pedidoIndex] = pedido;
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        console.log(`✅ [PUSHINPAY] Pedido ID ${pedido.id} ATUALIZADO com ID SMM e salvo.`);

        res.status(200).send('OK');

    } catch (error) {
        console.log(`[WEBHOOK-PP] Erro ao processar o webhook/envio SMM para ID ${gatewayIdParaBusca}:`, error);
        res.status(500).send('Erro interno ao processar webhook/envio SMM.');
    }
});


// -------------------------------------------------------------------------
// NOVO: Endpoint de Webhook do Mercado Pago
// -------------------------------------------------------------------------
app.post('/api/webhook-mp', async (req, res) => {
    
    const notification = req.body || {};
    
    // ... (Lógica de Webhook Mercado Pago inalterada) ...
    console.log('[WEBHOOK-MP] ---------------------------------------------');
    console.log('[WEBHOOK-MP] Notificação Recebida:', notification);
    console.log('[WEBHOOK-MP] ---------------------------------------------');
    
    const paymentId = notification.data?.id || notification.id;
    if (notification.topic !== 'payment' || !paymentId) {
        return res.status(200).send('Notificação ignorada.');
    }
    
    try {
        const configs = await loadConfig();
        const accessToken = configs.mercadopago?.access_token; //

        if (!accessToken) {
            console.error('[WEBHOOK-MP] Access Token do Mercado Pago não configurado.');
            return res.status(500).send('Erro: MP Token ausente.');
        }

        // 2. Consulta o status do pagamento na API do Mercado Pago
        const paymentResponse = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        const paymentData = paymentResponse.data;
        const externalReference = paymentData.external_reference; 
        const paymentStatus = paymentData.status; 

        console.log(`[WEBHOOK-MP] Status do Pagamento ${paymentId}: ${paymentStatus}. Referência Externa: ${externalReference}`);
        
        if (paymentStatus !== 'approved') {
            return res.status(200).send(`Pagamento ${paymentId} não aprovado (${paymentStatus}). Ignorado.`);
        }
        
        const pedidoId = parseInt(externalReference);
        if (isNaN(pedidoId) || !pedidoId) {
            console.warn(`[WEBHOOK-MP] Referência externa inválida/ausente: ${externalReference}.`);
            return res.status(200).send('Referência externa inválida. Ignorado.');
        }

        // 4. Encontra e processa o pedido local
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        const pedidoIndex = pedidos.findIndex(p => p.id === pedidoId);
        
        if (pedidoIndex === -1) {
            console.warn(`[WEBHOOK-MP] Pedido local ID ${pedidoId} não encontrado.`);
            return res.status(404).send('Pedido não encontrado.');
        }
        
        const pedido = pedidos[pedidoIndex];

        if (pedido.status === 'Enviado ao Fornecedor' || pedido.status.includes('Falha no Envio')) {
            return res.status(200).send('Pagamento já processado.');
        }
        
        // 5. Confirmação do Pagamento
        pedido.pagamento.status = 'Confirmado';
        pedido.pagamento.dataConfirmacao = new Date().toISOString();
        pedido.pagamento.external_id = paymentId.toString(); 
        console.log(`[MERCADO PAGO] Pagamento CONFIRMADO para Pedido ID ${pedido.id}.`);

        // 6. Envia o Pedido ao Fornecedor SMM
        const smmResult = await enviarParaFornecedor(pedido);
        
        // 7. Atualiza o status geral
        pedido.api_id = smmResult.api_id;
        pedido.api_status = smmResult.api_status;
        pedido.status = smmResult.api_id ? 'Enviado ao Fornecedor' : 'Falha no Envio SMM';

        // 8. Salva a atualização
        pedidos[pedidoIndex] = pedido;
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        console.log(`✅ [MERCADO PAGO] Pedido ID ${pedido.id} ATUALIZADO (Mercado Pago) e salvo.`);
        
        res.status(200).send('OK');

    } catch (error) {
        console.error('[WEBHOOK-MP] Erro geral ao processar webhook do Mercado Pago:', error.message);
        res.status(500).send('Erro interno.');
    }
});


// -------------------------------------------------------------------------
// ROTA NOVO: Dashboard Data (Faturamento, Lucro, etc.)
// -------------------------------------------------------------------------
app.get('/api/admin/dashboard-data', async (req, res) => {
    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        const pedidos = JSON.parse(pedidosData);
        
        let totalPedidos = 0;
        let totalFaturamento = 0;
        let totalLucro = 0;
        
        pedidos.forEach(pedido => {
            // Conta apenas pedidos com pagamento confirmado (ou enviado)
            if (pedido.pagamento && pedido.pagamento.status === 'Confirmado' || pedido.status.includes('Enviado')) {
                totalPedidos++;
                const valorVenda = pedido.valor || pedido.pacote.preco || 0; // Preço vendido
                totalFaturamento += valorVenda;
                
                // Cálculo de Lucro Estimado (AQUI ESTÁ A CHAVE)
                // O custo SMM não está salvo em pedidos.json, mas podemos ESTIMAR:
                // Custo SMM = (Valor de Venda) * (1 - Porcentagem Lucro) 
                // Exemplo: Se o lucro foi de 50%, o custo foi 50%
                
                // **Melhoria: Adicionando campo de custo_api_rate nos pacotes para cálculo preciso**
                // Por enquanto, vamos manter uma estimativa simples: 50% de lucro.
                
                const lucroEstimado = valorVenda * 0.5; // 50% de margem
                totalLucro += lucroEstimado;
            }
        });

        res.json({
            totalPedidos: totalPedidos,
            faturamento: totalFaturamento,
            lucro: totalLucro,
            pedidosStatus: {} // Placeholder para dados de gráfico
        });
        
    } catch (error) {
        console.error('[ADMIN] Erro ao buscar dados do Dashboard:', error);
        res.status(500).json({ error: 'Erro ao calcular métricas.' });
    }
});


// -------------------------------------------------------------------------
// ROTA NOVO: Checar Saldo SMM
// -------------------------------------------------------------------------
app.get('/api/admin/smm/check-balance', async (req, res) => {
    try {
        const configs = await loadConfig();
        const smmConfig = configs.fornecedor_smm;
        
        if (configs.modo === 'simulacao') { //
             return res.json({ success: true, balance: 999.99, message: 'Simulação de Saldo.' });
        }

        if (!smmConfig || !smmConfig.api_key || !smmConfig.api_url) { //
            return res.status(400).json({ success: false, message: 'Configuração SMM incompleta.' });
        }

        const balance = await checkSmmBalance(smmConfig);
        
        res.json({ success: true, balance: balance, message: 'Saldo obtido com sucesso.' });
        
    } catch (error) {
        console.error('[ADMIN] Erro ao checar saldo SMM:', error);
        res.status(500).json({ success: false, message: error.message || 'Erro interno ao checar saldo.' });
    }
});


// -------------------------------------------------------------------------
// ROTA NOVO: Puxar Serviços do Fornecedor SMM
// -------------------------------------------------------------------------
app.get('/api/admin/smm/fetch-services', async (req, res) => {
    try {
        const configs = await loadConfig();
        const smmConfig = configs.fornecedor_smm;
        
        if (!smmConfig || !smmConfig.api_key || !smmConfig.api_url) { //
            return res.status(400).json({ success: false, message: 'Configuração SMM incompleta. Salve as chaves primeiro.' });
        }

        // 1. Puxa a lista real de serviços do SMM
        const smmServices = await fetchSmmServices(smmConfig);
        
        // 2. Puxa os pacotes locais para comparação
        const pacotesData = await fs.readFile(PACOTES_PATH, 'utf-8'); //
        const pacotesJson = JSON.parse(pacotesData);
        
        // Converte a lista aninhada em uma lista simples de pacotes ativos
        let pacotesAtuais = [];
        pacotesJson.categorias.forEach(cat => {
            pacotesAtuais.push(...cat.pacotes);
        });
        
        res.json({ 
            success: true, 
            services: smmServices,
            pacotesAtuais: pacotesAtuais,
            message: 'Serviços do fornecedor e pacotes locais carregados.'
        });
        
    } catch (error) {
        console.error('[ADMIN] Erro ao buscar serviços SMM:', error);
        res.status(500).json({ success: false, message: error.message || 'Erro interno ao buscar serviços.' });
    }
});


// -------------------------------------------------------------------------
// ROTA NOVO: Salvar Pacotes Configurados (Atualiza pacotes.json)
// -------------------------------------------------------------------------
app.post('/api/admin/smm/save-packages', async (req, res) => {
    const { pacotes } = req.body; // Array de pacotes configurados do Admin.js
    
    if (!pacotes || pacotes.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum pacote para salvar foi recebido.' });
    }

    try {
        // 1. Carrega o template atual (principalmente as categorias)
        const pacotesData = await fs.readFile(PACOTES_PATH, 'utf-8'); //
        let pacotesJson = JSON.parse(pacotesData);
        let categoriasAtuais = pacotesJson.categorias;
        
        // 2. Cria um mapa de categorias para agrupar os novos pacotes
        const novasCategorias = {};
        
        // Mapeamento de IDs SMM para Categorias (simplificado - Categoria é salva no hidden field)
        pacotes.forEach(pacote => {
            const categoriaId = pacote.categoriaId || 'outros'; 
            
            if (!novasCategorias[categoriaId]) {
                 // Tenta encontrar o nome da categoria existente, senão usa um nome padrão
                const catExistente = categoriasAtuais.find(c => c.id === categoriaId);
                novasCategorias[categoriaId] = {
                    id: categoriaId,
                    nome: catExistente ? catExistente.nome : categoriaId.replace('_', ' ').toUpperCase(),
                    descricao: catExistente ? catExistente.descricao : 'Serviços configurados via painel admin.',
                    pacotes: []
                };
            }

            // Adiciona o pacote formatado
            novasCategorias[categoriaId].pacotes.push({
                id: parseInt(pacote.apiId), // Usando o ID da API como ID local (simplifica a busca)
                nome: pacote.nome,
                preco: parseFloat(pacote.preco),
                min: parseInt(pacote.apiMin),
                max: parseInt(pacote.apiMax),
                servico_api_id: pacote.apiId // ID do serviço no fornecedor
            });
        });

        // 3. Atualiza o JSON
        pacotesJson.categorias = Object.values(novasCategorias);
        
        await fs.writeFile(PACOTES_PATH, JSON.stringify(pacotesJson, null, 2)); //

        res.status(200).json({ 
            success: true, 
            count: pacotes.length,
            message: 'Pacotes da loja atualizados com sucesso.' 
        });

    } catch (error) {
        console.error('[ADMIN] Erro ao salvar pacotes SMM:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao salvar pacotes.' });
    }
});


// -------------------------------------------------------------------------
// ROTA MODIFICADA: Checar Status do Pedido no Fornecedor (Real ou Simulado)
// -------------------------------------------------------------------------
app.post('/api/admin/checar-status', async (req, res) => {
    const { pedidoId } = req.body;

    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        const pedidoIndex = pedidos.findIndex(p => p.id === parseInt(pedidoId));
        const configs = await loadConfig();

        if (pedidoIndex === -1 || !pedidos[pedidoIndex].api_id) {
            return res.status(404).json({ 
                status_smm: 'NOT_SENT', 
                mensagem: 'Pedido não encontrado ou não enviado ao SMM.' 
            });
        }
        
        const pedido = pedidos[pedidoIndex];
        const MODO_PRODUCAO = configs.modo === 'real';

        let currentStatus;
        
        if (MODO_PRODUCAO) {
            // --- MODO DE PRODUÇÃO (CHAMADA REAL) ---
            const smmConfig = configs.fornecedor_smm; //
            currentStatus = await checkSmmStatus(smmConfig, pedido.api_id);
            
        } else {
            // --- MODO DE SIMULAÇÃO (Mantendo a lógica anterior) ---
            const statusList = ['Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled'];
            currentStatus = statusList[Math.floor(Math.random() * statusList.length)]; 
        }

        // Atualiza e salva o status
        pedido.api_status = currentStatus;
        pedidos[pedidoIndex] = pedido;
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        res.json({
            status_smm: currentStatus,
            mensagem: `Status atualizado para: ${currentStatus}`
        });

    } catch (error) {
        console.error('Erro ao checar status do pedido:', error);
        res.status(500).json({ status_smm: 'ERROR', mensagem: 'Erro interno na checagem.' });
    }
});

// -------------------------------------------------------------------------
// ROTA FASE 4: Listar todos os pedidos (Para o Painel Admin)
// -------------------------------------------------------------------------
app.get('/api/admin/pedidos', async (req, res) => {
// ... (Rota inalterada) ...
    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        pedidos.sort((a, b) => b.id - a.id); 
        res.json(pedidos);
    } catch (error) {
        console.error('Erro ao ler pedidos para o Admin:', error);
        res.json([]);
    }
});

// -------------------------------------------------------------------------
// ROTA ADMIN: GET - Config SMM (para preencher o formulário)
// -------------------------------------------------------------------------
app.get('/api/admin/smm-config', async (req, res) => {
    try {
        const configs = await loadConfig();

        const { api_url, api_key } = configs.fornecedor_smm || {}; //

        return res.json({
            apiUrl: api_url || '',
            apiKeyExists: !!api_key 
        });

    } catch (error) {
        console.error('[ADMIN] Erro ao buscar configurações SMM:', error);
        res.status(500).json({ error: 'Erro ao buscar configurações.' });
    }
});


// -------------------------------------------------------------------------
// ROTA ADMIN: GET - Config Pagamento (para preencher o formulário)
// -------------------------------------------------------------------------
app.get('/api/admin/pagamento-config', async (req, res) => {
    try {
        const configs = await loadConfig(); //
        
        const pushinpay = configs.pushinpay || {};
        const mercadopago = configs.mercadopago || {};

        return res.json({
            gatewayAtivo: configs.gateway_ativo || 'PushinPay', 
            pushinpay: {
                apiUrl: pushinpay.api_url || '',
                apiKeyExists: !!pushinpay.api_key
            },
            mercadopago: {
                accessTokenExists: !!mercadopago.access_token
            }
        });

    } catch (error) {
        console.error('[ADMIN] Erro ao buscar configurações de pagamento:', error);
        res.status(500).json({ error: 'Erro ao buscar configurações.' });
    }
});


// -------------------------------------------------------------------------
// ROTA ADMIN: POST - Salvar Configuração do Fornecedor SMM
// -------------------------------------------------------------------------
app.post('/api/admin/config-smm', async (req, res) => {
    const { apiUrl, apiKey } = req.body;

    if (!apiUrl) {
        return res.status(400).json({ error: 'URL da API é obrigatória.' });
    }

    try {
        const configsData = await fs.readFile(CONFIGURACOES_PATH, 'utf-8'); //
        let configs = JSON.parse(configsData);

        const currentApiKey = configs.fornecedor_smm?.api_key;
        const finalApiKey = apiKey || currentApiKey;
        
        if (!finalApiKey) {
             return res.status(400).json({ error: 'Chave API é obrigatória no primeiro salvamento.' });
        }
        
        const smmConfig = configs.fornecedor_smm || {};

        configs.fornecedor_smm = {
            ...smmConfig,
            api_url: apiUrl,
            api_key: finalApiKey
        };

        await fs.writeFile(CONFIGURACOES_PATH, JSON.stringify(configs, null, 2));

        console.log('[ADMIN] Configuração do SMM atualizada com sucesso.');
        res.status(200).json({ message: 'Configuração atualizada com sucesso.' });

    } catch (error) {
        console.error('[ADMIN] Erro ao salvar configurações SMM:', error);
        res.status(500).json({ error: 'Erro interno ao salvar configuração.' });
    }
});


// -------------------------------------------------------------------------
// ROTA ADMIN: POST - Salvar Configuração de Pagamento
// -------------------------------------------------------------------------
app.post('/api/admin/config-pagamento', async (req, res) => {
    const { gatewayAtivo, ppKey, mpToken } = req.body;

    if (!['PushinPay', 'MercadoPago'].includes(gatewayAtivo)) {
          return res.status(400).json({ error: 'Gateway de pagamento inválido.' });
    }

    try {
        const configsData = await fs.readFile(CONFIGURACOES_PATH, 'utf-8'); //
        let configs = JSON.parse(configsData);
        
        // --- Processa PushinPay ---
        const currentPpKey = configs.pushinpay?.api_key;
        const finalPpKey = ppKey || currentPpKey;
        
        configs.pushinpay = {
            api_url: configs.pushinpay?.api_url || 'https://api.pushinpay.com.br/api/pix/cashIn', // Mantendo a URL fixa
            api_key: finalPpKey || ''
        };

        // --- Processa Mercado Pago ---
        const currentMpToken = configs.mercadopago?.access_token;
        const finalMpToken = mpToken || currentMpToken;
        
        configs.mercadopago = {
            access_token: finalMpToken || '',
        };
        
        configs.gateway_ativo = gatewayAtivo; //

        await fs.writeFile(CONFIGURACOES_PATH, JSON.stringify(configs, null, 2));
        
        if (finalMpToken) {
            initMPClient(finalMpToken);
        }

        console.log(`[ADMIN] Configuração de Pagamento salva. Gateway ativo: ${gatewayAtivo}`);
        res.status(200).json({ message: 'Configuração de Pagamento atualizada com sucesso.' });

    } catch (error) {
        console.error('[ADMIN] Erro ao salvar configurações de pagamento:', error);
        res.status(500).json({ error: 'Erro interno ao salvar configuração.' });
    }
});

/**
 * @description Carrega a lista de pedidos de forma segura.
 */
async function loadPedidos() {
    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        // Garante que o arquivo não esteja vazio
        if (pedidosData && pedidosData.trim().length > 0) {
            return JSON.parse(pedidosData);
        }
    } catch (error) {
        // Se o arquivo não existir (ENOENT), retorna array vazio
        if (error.code === 'ENOENT') {
            return [];
        }
        console.error('Erro ao carregar pedidos.json:', error);
        throw error;
    }
    // Este return trata o caso em que o arquivo existe, mas está vazio (não JSON válido).
    return []; 
}

// ------------------------------------------------------------------------
// ROTAS PRINCIPAIS DA LOJA (PARA O CLIENTE)
// ------------------------------------------------------------------------

/**
 * @description Rota para o frontend carregar a lista de pacotes.
 */
app.get('/api/pacotes', async (req, res) => {
    try {
        const pacotesData = await fs.readFile(PACOTES_PATH, 'utf-8');
        res.json(JSON.parse(pacotesData));
    } catch (error) {
        console.error('Erro ao carregar pacotes.json:', error);
        res.status(500).json({ error: 'Falha ao carregar pacotes.' });
    }
});


/**
 * @description Rota para o cliente criar um pedido.
 * Salva no JSON e inicia o pagamento.
 */
app.post('/api/pedido', async (req, res) => {
    const { pacoteId, link } = req.body;
    
    // 1. Validação básica (deveria ser mais completa)
    if (!pacoteId || !link) {
        return res.status(400).json({ erro: 'Dados de pedido inválidos.' });
    }

    try {
        const config = await loadConfig();
        const pacotesData = await fs.readFile(PACOTES_PATH, 'utf-8');
        const pacotes = JSON.parse(pacotesData);

        // Busca o pacote pelo ID
        let pacoteEncontrado = null;
        pacotes.categorias.forEach(cat => {
            const p = cat.pacotes.find(p => p.id === pacoteId);
            if (p) {
                pacoteEncontrado = p;
            }
        });

        if (!pacoteEncontrado) {
            return res.status(404).json({ erro: 'Pacote não encontrado.' });
        }
        
        // Determina ID do pedido
        const pedidos = await loadPedidos();
        const novoPedidoId = pedidos.length > 0 ? pedidos[pedidos.length - 1].id + 1 : 1000;

        // Cria o objeto do novo pedido
        const novoPedido = {
            id: novoPedidoId,
            data: new Date().toISOString(),
            link: link,
            pacoteId: pacoteId,
            pacoteNome: pacoteEncontrado.nome,
            quantidade: pacoteEncontrado.min, // Usando min como quantidade padrão
            valor: pacoteEncontrado.preco.toFixed(2),
            email: 'cliente@teste.com', // Mock - deve vir do formulário
            status: 'Aguardando Pagamento',
            pagamento: {
                gateway: config.gateway_ativo,
                status: 'Pendente',
            },
            api: {}
        };
        
        // 2. Salva o pedido no JSON
        pedidos.push(novoPedido);
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        // 3. Inicia o Pagamento
        let pagamentoResponse;
        
        if (config.gateway_ativo === 'MercadoPago') {
            const externalRef = `SMM-${novoPedidoId}`;
            const description = `${novoPedido.pacoteNome} (${novoPedido.quantidade})`;
            
            // Usa a função do módulo mercadopago.js
            pagamentoResponse = await criarPagamentoPixMP(
                novoPedido.valor, 
                description, 
                novoPedido.email, 
                externalRef
            );
            
        } else if (config.gateway_ativo === 'PushinPay') {
            // Lógica de Pagamento PushinPay (A ser implementada ou simulada)
            pagamentoResponse = {
                id: `PUSHIN-${novoPedidoId}`,
                status: 'pending',
                qrCodeBase64: 'mock_base64_pushinpay_qr_code',
                pixCode: 'mock_pix_copia_e_cola_pushinpay',
                externalReference: `SMM-${novoPedidoId}`
            };
        } else {
             // Modo Simulação/Outro
             pagamentoResponse = { 
                 id: `MOCK-${novoPedidoId}`, 
                 status: 'pending', 
                 qrCodeBase64: 'mock_base64_qr_code', 
                 pixCode: 'mock_pix_copia_e_cola', 
                 externalReference: `SMM-${novoPedidoId}` 
            };
        }
        
        // Atualiza o pedido com os dados de pagamento (ID do PIX, status, etc.)
        novoPedido.pagamento.id = pagamentoResponse.id;
        novoPedido.pagamento.status = pagamentoResponse.status === 'approved' ? 'Confirmado' : 'Aguardando PIX';
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));
        
        // 4. Retorna os dados do Pix para o frontend
        res.json({
            pedidoId: novoPedidoId,
            qrCodeBase64: pagamentoResponse.qrCodeBase64,
            pixCode: pagamentoResponse.pixCode,
            valor: novoPedido.valor,
            mensagem: 'Pedido criado com sucesso! Prossiga para o pagamento Pix.'
        });

    } catch (error) {
        console.error('🔴 Erro fatal ao processar pedido:', error);
        res.status(500).json({ erro: `Falha interna no servidor: ${error.message}` });
    }
});


/**
 * @description Rota para o Webhook do Mercado Pago
 * Recebe a notificação de pagamento confirmado.
 * ⚠️ ATENÇÃO: Esta rota precisa ser exposta publicamente (ex: via ngrok) para funcionar.
 */
app.post('/api/webhook-mp', async (req, res) => {
    console.log('\n======================================================');
    console.log('🔔 WEBHOOK MP RECEBIDO');
    console.log('======================================================');
    
    // O Mercado Pago envia notificações de diferentes tipos.
    // Você deve implementar a lógica para verificar a autenticidade (secret) e o tipo.
    
    // ⚠️ IMPLEMENTAÇÃO BÁSICA PARA PIX (ASSUME QUE A NOTIFICAÇÃO É VÁLIDA)
    
    // Tenta encontrar o external_reference ou o ID de pagamento na requisição.
    // Depende da configuração do seu IPN/Webhook no MP.
    let externalReference = req.body.data?.id || req.body.external_reference; // Exemplo simplificado
    
    if (!externalReference) {
        console.warn('Webhook: external_reference não encontrado no payload.');
        return res.status(200).send('OK (Sem external_reference)');
    }

    try {
        const pedidos = await loadPedidos();
        const pedidoId = parseInt(externalReference.replace('SMM-', '')); 
        const pedidoIndex = pedidos.findIndex(p => p.id === pedidoId);

        if (pedidoIndex === -1) {
            console.warn(`Webhook: Pedido ${pedidoId} não encontrado.`);
            return res.status(200).send('OK (Pedido não encontrado)');
        }
        
        // Verifica se o pagamento já está confirmado para evitar reenvio
        if (pedidos[pedidoIndex].pagamento.status === 'Confirmado' && pedidos[pedidoIndex].status === 'Aguardando Envio') {
            console.log(`Webhook: Pedido ${pedidoId} já estava confirmado. Ignorando.`);
            return res.status(200).send('OK (Já confirmado)');
        }

        // Simulação de verificação de status (Na vida real, você chamaria a API do MP para confirmar)
        const statusMP = req.body.type === 'payment' && req.body.action === 'payment.created' ? 'approved' : 'approved'; // Assumindo 'approved' para simplificar o teste.

        if (statusMP === 'approved') {
            
            // 1. Atualiza Status de Pagamento
            pedidos[pedidoIndex].pagamento.status = 'Confirmado';
            pedidos[pedidoIndex].status = 'Aguardando Envio'; // Altera status para o SMM
            
            // 2. Envia para o Painel SMM
            // Supondo que você tem o serviço SMM disponível
            const smmResponse = await SMM.sendOrderSMM(pedidos[pedidoIndex]);
            
            // 3. Atualiza com o ID e Status da API SMM
            pedidos[pedidoIndex].api = {
                api_id: smmResponse.api_id,
                api_status: smmResponse.api_status || 'Processing',
                data_envio: new Date().toISOString()
            };
            pedidos[pedidoIndex].status = 'Em Processamento SMM';

            // 4. Salva no JSON
            await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

            console.log(`✅ Pedido ${pedidoId} CONFIRMADO e ENVIADO para SMM. API ID: ${smmResponse.api_id}`);
        }
        
        res.status(200).send('OK');

    } catch (error) {
        console.error('🔴 Erro no Webhook MP:', error);
        res.status(500).send('Erro interno do servidor.');
    }
});


// -------------------------------------------------------------------------
// Endpoint de Consulta Simples de Status
// -------------------------------------------------------------------------
app.get('/api/check-status/:pedidoId', async (req, res) => {
// ... (Rota inalterada) ...
    const { pedidoId } = req.params;

    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        const pedidos = JSON.parse(pedidosData);

        const pedido = pedidos.find(p => p.id === parseInt(pedidoId));

        if (!pedido) {
            return res.status(404).json({ status: 'Não encontrado' });
        }

        return res.json({
            status_pagamento: pedido.pagamento.status,
            status_envio: pedido.status
        });

    } catch (error) {
        console.error(`Erro ao checar status do pedido ${pedidoId}:`, error);
        return res.status(500).json({ status: 'Erro' });
    }
});

// -------------------------------------------------------------------------
// Inicialização do Servidor
// -------------------------------------------------------------------------
app.listen(PORT, async () => {
    const config = await loadConfig();
    console.log(`\n✅ Backend rodando em http://localhost:${PORT}`);
    console.log(`-------------------------------------------------------------------------`);
    console.log(`🔑 MODO DE OPERAÇÃO: ${config.modo.toUpperCase()}`);
    if (config.modo === 'simulacao') {
        console.log('⚠️ ATENÇÃO: Pagamentos e SMM estão em modo de SIMULAÇÃO/TESTE.');
        console.log('Para produção, altere o campo "modo" em configuracoes.json para "real" e insira as chaves reais.');
    } else {
        console.log('🚀 ATENÇÃO: Pagamentos e Envio SMM estão em modo REAL.');
    }
    console.log(`-------------------------------------------------------------------------`);
});