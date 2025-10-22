const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); 
const { initMPClient, criarPagamentoPixMP } = require('./mercadopago'); // NOVO: Módulo Mercado Pago

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
// 💥 JÁ EXISTENTE: Para tratar payloads application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true })); 
app.use(cors());

// -------------------------------------------------------------------------
// Configuração para Servir a Pasta Frontend (MUITO IMPORTANTE)
// -------------------------------------------------------------------------
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
        const configsData = await fs.readFile(CONFIGURACOES_PATH, 'utf-8');
        let configs = JSON.parse(configsData);
        
        // NOVO: Inicializa o cliente Mercado Pago ao carregar a config (se houver token)
        if (configs.mercadopago && configs.mercadopago.access_token) {
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
    const FORNECEDOR_CONFIG = config.fornecedor_smm;
    const MODO_PRODUCAO = config.modo === 'real';

    if (MODO_PRODUCAO) {
        // --- MODO DE PRODUÇÃO (CHAMADA REAL) ---
        console.log(`[PROD-SMM] Tentando enviar pedido ID ${pedido.id} REALMENTE para o fornecedor...`);
        try {
            const serviceId = FORNECEDOR_CONFIG.servico_padrao; 
            const quantity = FORNECEDOR_CONFIG.quantidade_padrao;

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
// Rota para obter os pacotes
// -------------------------------------------------------------------------
app.get('/api/pacotes', async (req, res) => {
    try {
        const data = await fs.readFile(PACOTES_PATH, 'utf-8');
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
        
        const pedidoCompleto = {
            id: Date.now(), 
            ...novoPedido,
            data: new Date().toISOString(),
            status: 'Pendente Pagamento',
            api_status: null, 
            api_id: null, 
            pagamento: {
                status: 'Aguardando',
                metodo: null,
                gateway: null, // NOVO: Para saber qual gateway foi usado
                qr_code_base64: null, // NOVO: Padronizado
                pix_code: null,      // NOVO: Padronizado
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
        const valor = configs.pagamento.valor_padrao_pacote || 1.00; // Valor do pacote
        
        let qrCodePix;
        let codigoPixCopiaCola;
        let externalIdGateway;
        let gatewayUsado = gatewayAtivo; 

        if (gatewayAtivo === 'PushinPay') {
            
            const ppConfig = configs.pushinpay;
            if (!ppConfig || !ppConfig.api_key || !ppConfig.api_url) {
                 throw new Error('PushinPay não configurado no painel admin.');
            }
            
            // Usa a config antiga para a URL do webhook (simulação/real)
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
                            'Authorization': `Bearer ${ppConfig.api_key}`, 
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
            gateway: gatewayUsado, // NOVO: Salva qual gateway foi usado
            valor: valor,
            // Padroniza as chaves de Pix
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
            gateway: gatewayUsado, // NOVO
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


// -------------------------------------------------------------------------
// Endpoint de Webhook (Recebe confirmação da PushinPay e ENVIA AO SMM)
// -------------------------------------------------------------------------
app.post('/api/webhook', async (req, res) => {
    
    const webhookData = req.body || {};
    
    console.log('[WEBHOOK-PP] REQUEST RECEBIDO.');
    console.log('[WEBHOOK-PP] Dados Recebidos (req.body):', webhookData);
    
    // Tenta obter o ID do gateway (PushinPay usa external_id)
    const rawGatewayId = webhookData.external_id || webhookData.id; 
    
    // Converte o ID recebido para minúsculas
    const gatewayIdParaBusca = rawGatewayId ? rawGatewayId.toLowerCase() : null;
    
    const statusPagamento = webhookData.status || webhookData.status_pagamento; 

    if (!gatewayIdParaBusca) {
          console.warn('[WEBHOOK-PP] Webhook recebido, mas sem ID de gateway válido. Ignorado.');
          return res.status(200).send('Webhook recebido, mas sem ID de gateway válido.');
    }
    
    // Confirma status de sucesso em produção
    const statusAprovado = ['APPROVED', 'CONFIRMED', 'PAID'];
    if (!statusPagamento || !statusAprovado.includes(statusPagamento.toUpperCase())) {
        console.log(`[WEBHOOK-PP] Status de pagamento para ID ${gatewayIdParaBusca} não aprovado: ${statusPagamento}. Ignorado.`);
        return res.status(200).send(`Pagamento status: ${statusPagamento}. Ignorado.`);
    }

    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        
        // Busca o pedido garantindo que o ID salvo também seja minúsculo antes da comparação.
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
    
    // Log de Debug
    console.log('[WEBHOOK-MP] ---------------------------------------------');
    console.log('[WEBHOOK-MP] Notificação Recebida:', notification);
    console.log('[WEBHOOK-MP] ---------------------------------------------');
    
    // 1. Verifica se a notificação é de pagamento e possui ID (Pode ser 'data.id' dependendo do formato)
    const paymentId = notification.data?.id || notification.id;
    if (notification.topic !== 'payment' || !paymentId) {
        return res.status(200).send('Notificação ignorada.');
    }
    
    try {
        const configs = await loadConfig();
        const accessToken = configs.mercadopago?.access_token;

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
        const externalReference = paymentData.external_reference; // ID do pedido local
        const paymentStatus = paymentData.status; // 'approved', 'pending', 'rejected', etc.

        console.log(`[WEBHOOK-MP] Status do Pagamento ${paymentId}: ${paymentStatus}. Referência Externa: ${externalReference}`);
        
        // 3. Verifica se o pagamento foi aprovado
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
// ROTA FASE 4: Listar todos os pedidos (Para o Painel Admin)
// -------------------------------------------------------------------------
app.get('/api/admin/pedidos', async (req, res) => {
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
app.get('/api/admin/config/smm', async (req, res) => {
    try {
        const configs = await loadConfig();

        const { api_url, api_key } = configs.fornecedor_smm || {};

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
// ROTA FASE 4: Checar Status do Pedido no Fornecedor (Simulado)
// -------------------------------------------------------------------------
app.post('/api/admin/checar-status', async (req, res) => {
    const { pedidoId } = req.body;

    try {
        const pedidosData = await fs.readFile(PEDIDOS_PATH, 'utf-8');
        let pedidos = JSON.parse(pedidosData);
        const pedidoIndex = pedidos.findIndex(p => p.id === parseInt(pedidoId));

        if (pedidoIndex === -1 || !pedidos[pedidoIndex].api_id) {
            return res.status(404).json({ 
                status_smm: 'NOT_FOUND', 
                mensagem: 'Pedido não encontrado ou não enviado ao SMM.' 
            });
        }
        
        const statusList = ['Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled'];
        const currentStatus = statusList[Math.floor(Math.random() * statusList.length)]; 
        
        pedidos[pedidoIndex].api_status = currentStatus;
        await fs.writeFile(PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

        res.json({
            status_smm: currentStatus,
            mensagem: `Status simulado atualizado para: ${currentStatus}`
        });

    } catch (error) {
        console.error('Erro ao checar status do pedido:', error);
        res.status(500).json({ status_smm: 'ERROR', mensagem: 'Erro interno na checagem.' });
    }
});

// ARQUIVO: /backend/server.js

// -------------------------------------------------------------------------
// FASE 4: Endpoint de Consulta Simples de Status
// -------------------------------------------------------------------------
app.get('/api/check-status/:pedidoId', async (req, res) => {
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
// ROTA ADMIN: POST - Salvar Configuração do Fornecedor SMM
// -------------------------------------------------------------------------
app.post('/api/admin/config/smm', async (req, res) => {
    const { apiUrl, apiKey } = req.body;

    if (!apiUrl) {
        return res.status(400).json({ error: 'URL da API é obrigatória.' });
    }

    try {
        const configsData = await fs.readFile(CONFIGURACOES_PATH, 'utf-8');
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
// ROTA ADMIN: GET - Buscar Configuração de Pagamento (Gateway Ativo e Chaves)
// -------------------------------------------------------------------------
app.get('/api/admin/config/pagamento', async (req, res) => {
    try {
        const configs = await loadConfig();
        
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
// ROTA ADMIN: POST - Salvar Configuração de Pagamento
// -------------------------------------------------------------------------
app.post('/api/admin/config/pagamento', async (req, res) => {
    const { gatewayAtivo, ppUrl, ppKey, mpToken } = req.body;

    if (!['PushinPay', 'MercadoPago'].includes(gatewayAtivo)) {
          return res.status(400).json({ error: 'Gateway de pagamento inválido.' });
    }

    try {
        const configsData = await fs.readFile(CONFIGURACOES_PATH, 'utf-8');
        let configs = JSON.parse(configsData);
        
        // --- Processa PushinPay ---
        const currentPpKey = configs.pushinpay?.api_key;
        const finalPpKey = ppKey || currentPpKey;
        
        configs.pushinpay = {
            api_url: ppUrl || configs.pushinpay?.api_url || '',
            api_key: finalPpKey || ''
        };

        // --- Processa Mercado Pago ---
        const currentMpToken = configs.mercadopago?.access_token;
        const finalMpToken = mpToken || currentMpToken;
        
        configs.mercadopago = {
            access_token: finalMpToken || '',
        };
        
        // Salva o gateway ativo
        configs.gateway_ativo = gatewayAtivo;


        await fs.writeFile(CONFIGURACOES_PATH, JSON.stringify(configs, null, 2));
        
        // NOVO: Inicializa o cliente MP IMEDIATAMENTE após salvar a nova chave
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
