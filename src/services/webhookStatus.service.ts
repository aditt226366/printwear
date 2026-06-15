type WhatsAppSendStatus = {
  status: "not_sent" | "sent" | "failed";
  at?: string;
  messageId?: string;
  leadId?: string;
  recipient?: string;
  errorMessage?: string;
};

type WebhookRuntimeStatus = {
  lastWebhookReceivedAt: string | null;
  lastProcessedMessageId: string | null;
  lastWhatsAppSendStatus: WhatsAppSendStatus;
};

const status: WebhookRuntimeStatus = {
  lastWebhookReceivedAt: null,
  lastProcessedMessageId: null,
  lastWhatsAppSendStatus: {
    status: "not_sent"
  }
};

export const webhookStatusService = {
  markWebhookReceived(receivedAt = new Date()) {
    status.lastWebhookReceivedAt = receivedAt.toISOString();
  },

  markMessageProcessed(messageId: string) {
    status.lastProcessedMessageId = messageId;
  },

  markWhatsAppSent(input: { messageId?: string; leadId: string; recipient: string }) {
    status.lastWhatsAppSendStatus = {
      status: "sent",
      at: new Date().toISOString(),
      messageId: input.messageId,
      leadId: input.leadId,
      recipient: input.recipient
    };
  },

  markWhatsAppFailed(input: { leadId?: string; recipient?: string; errorMessage: string }) {
    status.lastWhatsAppSendStatus = {
      status: "failed",
      at: new Date().toISOString(),
      leadId: input.leadId,
      recipient: input.recipient,
      errorMessage: input.errorMessage
    };
  },

  snapshot(webhookUrl: string) {
    return {
      webhookUrl,
      ...status
    };
  }
};
