import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { answerPreCheckout, fulfillSuccessfulPayment, processRefundedPayment, sendWelcome } from '../telegram.js';
import { upsertUser } from '../auth.js';
import { pool } from '../db.js';
import { attachSharedChat, paymentSupport } from '../services/v4.js';
import { sendBotMessage } from '../telegram.js';

export async function telegramWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/telegram/webhook', { config:{ rateLimit:false } }, async (request, reply) => {
    if (request.headers['x-telegram-bot-api-secret-token'] !== config.WEBHOOK_SECRET) return reply.code(401).send({ok:false});
    const update=request.body as any;
    if(update.pre_checkout_query) {
      const q=update.pre_checkout_query;
      const purchase=await pool.query(`SELECT user_id::text,stars,status FROM purchases WHERE id=$1`,[q.invoice_payload]);
      const valid=purchase.rows[0] && purchase.rows[0].status==='pending' && purchase.rows[0].user_id===String(q.from.id)
        && q.currency==='XTR' && Number(q.total_amount)===Number(purchase.rows[0].stars);
      await answerPreCheckout(q.id,Boolean(valid),valid?undefined:'Счёт устарел или был изменён. Откройте магазин заново.');
    }
    const message=update.message;
    if(message?.successful_payment) await fulfillSuccessfulPayment(message);
    if(message?.chat_shared&&message?.from?.id)await attachSharedChat(message.from.id,message.chat_shared);
    if(message?.refunded_payment?.telegram_payment_charge_id)await processRefundedPayment(message.refunded_payment.telegram_payment_charge_id);
    if(message?.text?.startsWith('/paysupport')) {
      await upsertUser(message.from,null);
      await paymentSupport(message.from.id,undefined,'Обращение создано через команду /paysupport');
      await sendBotMessage(message.chat.id,'Обращение по оплате создано. Откройте игру → Ещё → Покупки, чтобы указать конкретный чек и описание проблемы.');
    }
    if(message?.text?.startsWith('/start')) {
      const payload=message.text.split(/\s+/)[1] ?? null;
      await upsertUser(message.from,payload);
      await sendWelcome(message.chat.id,message.from.first_name);
    }
    return {ok:true};
  });
}
