import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  answerInboundMessage,
  type InboundAssistantDeps,
} from "./inbound-assistant.js";

// PORQUÊ: adapter do Bot API do Telegram. Chat desconhecido vira UNCLAIMED
// (orienta vincular) em vez de atender no escuro. Mensagem sem texto vira IGNORED.

export interface TelegramWebhookDeps extends InboundAssistantDeps {
  readonly orgBindings: Map<string, string>;
}

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
    })
    .optional(),
});

export async function registerTelegramWebhook(
  app: FastifyInstance,
  deps: TelegramWebhookDeps,
): Promise<void> {
  app.post(
    "/webhooks/telegram",
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const parsed = TelegramUpdateSchema.safeParse(request.body);
      if (!parsed.success || !parsed.data.message) {
        app.log.info({ channel: "TELEGRAM", outcome: "INVALID_PAYLOAD" });
        return reply.code(400).send({ error: "payload inválido" });
      }
      const chatRef = String(parsed.data.message.chat.id);
      const orgId = deps.orgBindings.get(chatRef);
      if (!orgId) {
        app.log.info({ channel: "TELEGRAM", outcome: "UNCLAIMED_CHAT" });
        return reply.code(200).send({
          replyKind: "UNCLAIMED",
          hint: "vincule este chat a uma conta antes de usar",
        });
      }
      const text = parsed.data.message.text;
      if (!text) {
        app.log.info({
          orgId,
          channel: "TELEGRAM",
          outcome: "IGNORED_NON_TEXT",
        });
        return reply.code(200).send({ replyKind: "IGNORED" });
      }
      const outcome = await answerInboundMessage(
        { orgId, channel: "TELEGRAM", contactRef: chatRef, text },
        deps,
      );
      app.log.info({
        orgId,
        channel: "TELEGRAM",
        replyKind: outcome.replyKind,
      });
      return reply.code(200).send(outcome);
    },
  );
}
