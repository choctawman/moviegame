import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "@/server/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_COMMISSIONER_EMAIL ?? "commissioner@example.com";
  const password = process.env.SEED_COMMISSIONER_PASSWORD ?? "password123";

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      isCommissioner: true,
    },
    create: {
      email,
      passwordHash: await hashPassword(password),
      isCommissioner: true,
    },
  });

  console.log(`Seeded commissioner user: ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
