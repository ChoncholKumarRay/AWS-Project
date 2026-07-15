import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export type AppPrismaClient = PrismaClient;

let prisma: AppPrismaClient | undefined;

export function createPrismaClient(connectionString: string): AppPrismaClient {
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter
  });
}

export function getPrismaClient(): AppPrismaClient {
  if (prisma) {
    return prisma;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create the Prisma client.");
  }

  prisma = createPrismaClient(databaseUrl);
  return prisma;
}

export async function disconnectPrismaClient() {
  if (!prisma) {
    return;
  }

  await prisma.$disconnect();
  prisma = undefined;
}
