const { MercadoPagoConfig, Payment } = require('mercadopago'); // <<<<<<< LINHA ADICIONADA!

let mpClient = null;

/**
 * @description Inicializa o cliente do Mercado Pago com o Access Token.
 */
function initMPClient(accessToken) {
    if (!accessToken) {
        console.error('[MP] Access Token do Mercado Pago não fornecido.');
        mpClient = null;
        return false;
    }
    
    try {
        // Agora MercadoPagoConfig está definido graças ao require acima
        mpClient = new MercadoPagoConfig({ accessToken: accessToken });
        console.log('[MP] Cliente Mercado Pago inicializado com sucesso.');
        return true;
    } catch (error) {
        console.error('[MP] Erro ao inicializar o cliente Mercado Pago:', error.message);
        mpClient = null;
        return false;
    }
}

/**
 * @description Cria um pagamento Pix na API do Mercado Pago.
 */
async function criarPagamentoPixMP(valor, description, email, externalReference) {
    
    if (!mpClient) {
        throw new Error('Cliente do Mercado Pago não inicializado. Verifique o Access Token.');
    }

    // Payment agora também está definido
    const paymentService = new Payment(mpClient);

    const paymentData = {
        transaction_amount: valor,
        description: description,
        payment_method_id: 'pix',
        external_reference: externalReference, // Usado para rastrear o pedido local
        payer: {
            email: email,
            first_name: "Cliente", 
            last_name: "Loja SMM"
            // Se precisar de CPF, adicione: identification: { type: 'CPF', number: '...' }
        },
        // Mude esta URL para o seu domínio real do ngrok ou produção
        notification_url: 'https://talitha-paramagnetic-semiwildly.ngrok-free.dev/api/webhook-mp', 
        installments: 1
    };

    try {
        const result = await paymentService.create({ body: paymentData });
        
        // Retorna os dados necessários para o frontend
        const pixInfo = result.point_of_interaction.transaction_data;
        
        return {
            id: result.id, // ID do pagamento MP
            status: result.status,
            amount: result.transaction_amount,
            qrCodeBase64: pixInfo.qr_code_base64, // Base64 da imagem
            pixCode: pixInfo.qr_code,            // Pix Copia e Cola
            externalReference: result.external_reference
        };

    } catch (error) {
        console.error('[MP] Erro ao criar pagamento Pix no Mercado Pago:', error.message || error);
        throw new Error('Falha ao processar pagamento com o Mercado Pago.');
    }
}

module.exports = {
    initMPClient,
    criarPagamentoPixMP
};