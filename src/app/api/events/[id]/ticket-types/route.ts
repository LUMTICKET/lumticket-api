import { prisma } from "@/lib/prisma";
import { apiOk } from "@/lib/api-response";

// Ticket types with live remaining-availability for an event.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const ticketTypes = await prisma.ticketType.findMany({ where: { eventId } });

  return apiOk(
    ticketTypes.map((t) => ({
      ...t,
      remaining: t.quantity - t.quantitySold,
    })),
  );
}
