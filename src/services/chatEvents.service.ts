import type { Response } from "express";

type ChatEvent = {
  type: "message.created" | "message.status" | "lead.updated" | "order.updated";
  leadId?: string;
  payload?: unknown;
};

const clients = new Set<Response>();

function writeEvent(response: Response, event: ChatEvent) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export const chatEventsService = {
  subscribe(response: Response) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    response.write(": connected\n\n");
    clients.add(response);

    const keepAlive = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, 25_000);

    response.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(response);
    });
  },

  publish(event: ChatEvent) {
    for (const client of clients) {
      writeEvent(client, event);
    }
  }
};
