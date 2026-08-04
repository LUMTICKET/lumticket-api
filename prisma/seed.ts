import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await hashPassword("Password123!");

  // --- Admin -----------------------------------------------------------
  await prisma.user.upsert({
    where: { email: "admin@lumticket.test" },
    update: {},
    create: { role: "ADMINISTRATOR", name: "Ada Admin", email: "admin@lumticket.test", passwordHash: password },
  });

  const kycReviewer = await prisma.user.upsert({
    where: { email: "kyc.reviewer@lumticket.test" },
    update: {},
    create: { role: "KYC_REVIEWER", name: "Kelvin Reviewer", email: "kyc.reviewer@lumticket.test", passwordHash: password },
  });
  void kycReviewer;

  // --- Bus operator tenant + staff + fleet ------------------------------
  const busOperator = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      type: "BUS",
      legalName: "Sunrise Coaches Ltd",
      country: "Malawi",
      status: "ACTIVE",
    },
  });

  const opsManager = await prisma.user.upsert({
    where: { email: "ops@sunrise.test" },
    update: {},
    create: {
      role: "OPERATIONS_MANAGER",
      tenantId: busOperator.id,
      name: "Oscar Ops",
      email: "ops@sunrise.test",
      passwordHash: password,
    },
  });

  await prisma.user.upsert({
    where: { email: "inspector@sunrise.test" },
    update: {},
    create: {
      role: "TICKET_INSPECTOR",
      tenantId: busOperator.id,
      name: "Ida Inspector",
      email: "inspector@sunrise.test",
      passwordHash: password,
    },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { registrationNumber: "BT-1234" },
    update: {},
    create: { operatorId: busOperator.id, registrationNumber: "BT-1234", type: "BUS", capacity: 44, status: "ACTIVE" },
  });

  const driverUser = await prisma.user.upsert({
    where: { email: "driver@sunrise.test" },
    update: {},
    create: { role: "DRIVER", tenantId: busOperator.id, name: "Dan Driver", email: "driver@sunrise.test", passwordHash: password },
  });

  const driver = await prisma.driver.upsert({
    where: { userId: driverUser.id },
    update: {},
    create: {
      operatorId: busOperator.id,
      userId: driverUser.id,
      licenseNumber: "DL-9988",
      licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: "ACTIVE",
    },
  });

  const trip = await prisma.routeTrip.create({
    data: {
      operatorId: busOperator.id,
      origin: "Lilongwe",
      destination: "Blantyre",
      scheduleDatetime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      price: 15000,
      vehicleId: vehicle.id,
      driverId: driver.id,
      status: "SCHEDULED",
      seats: {
        create: Array.from({ length: 10 }, (_, i) => ({ seatNo: String(i + 1).padStart(2, "0") })),
      },
    },
  });
  void opsManager;

  // --- Event organizer tenant + event -----------------------------------
  const eventOrganizer = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      type: "EVENT",
      legalName: "Lilongwe Live Events",
      country: "Malawi",
      status: "ACTIVE",
    },
  });

  await prisma.user.upsert({
    where: { email: "organizer@lle.test" },
    update: {},
    create: {
      role: "OPERATIONS_MANAGER",
      tenantId: eventOrganizer.id,
      name: "Eve Organizer",
      email: "organizer@lle.test",
      passwordHash: password,
    },
  });

  const event = await prisma.event.create({
    data: {
      organizerId: eventOrganizer.id,
      name: "Lake of Stars Festival",
      venue: "Mangochi Lakeshore",
      eventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      capacity: 5000,
      status: "PUBLISHED",
      ticketTypes: {
        create: [
          { name: "General", price: 20000, quantity: 4000 },
          { name: "VIP", price: 60000, quantity: 500 },
        ],
      },
    },
  });

  // --- Retail agent tenant ------------------------------------------------
  const retailAgent = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      type: "RETAIL",
      legalName: "Mzuzu Corner Shop",
      country: "Malawi",
      status: "INACTIVE", // pending KYC, see docs/TESTING.md walkthrough
    },
  });

  await prisma.user.upsert({
    where: { email: "agent@mzuzucorner.test" },
    update: {},
    create: {
      role: "RETAIL_POS_AGENT",
      tenantId: retailAgent.id,
      name: "Rita Agent",
      email: "agent@mzuzucorner.test",
      passwordHash: password,
    },
  });

  // --- Customer -----------------------------------------------------------
  const customerUser = await prisma.user.upsert({
    where: { email: "customer@example.test" },
    update: {},
    create: { role: "CUSTOMER", name: "Chikondi Customer", email: "customer@example.test", passwordHash: password },
  });

  await prisma.customer.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: { userId: customerUser.id, fullName: "Chikondi Customer", email: "customer@example.test", phone: "+265900000000" },
  });

  console.log("Seed complete.");
  console.log(`  Bus trip:        ${trip.origin} -> ${trip.destination}  (id: ${trip.id})`);
  console.log(`  Event:           ${event.name}  (id: ${event.id})`);
  console.log("  All seeded users share the password: Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
