import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  answerInboundMessage,
  type InboundAssistantDeps,
} from "./inbound-assistant.js";

// PORQUÊ: adapter fino. Toda decisão vive em inbound-assistant; aqui só o
// formato do webhook do provedor WhatsApp vira InboundMessage.

export type WhatsappWebhookDeps = InboundAssistantDeps;

const WhatsappInboundSchema = z.object({
  orgId: z.string().min(1),
  fromPhone: z.string().min(1),
  text: z.string().min(1),
});

export async function registerWhatsappWebhook(
  app: FastifyInstance,
  deps: WhatsappWebhookDeps,
): Promise<void> {
  app.post(
    "/webhooks/whatsapp",
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const parsed = WhatsappInboundSchema.safeParse(request.body);
      if (!parsed.success) {
        app.log.info({ channel: "WHATSAPP", outcome: "INVALID_PAYLOAD" });
        return reply.code(400).send({ error: "payload inválido" });
      }
      const outcome = await answerInboundMessage(
        {
          orgId: parsed.data.orgId,
          channel: "WHATSAPP",
          contactRef: parsed.data.fromPhone,
          text: parsed.data.text,
        },
        deps,
      );
      app.log.info({
        orgId: parsed.data.orgId,
        channel: "WHATSAPP",
        replyKind: outcome.replyKind,
      });
      return reply.code(200).send(outcome);
    },
  );
}
