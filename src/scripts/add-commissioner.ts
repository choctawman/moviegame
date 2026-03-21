import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.toLowerCase();

  if (!email) {
    throw new Error("Usage: npm run commissioner:add -- <email>");
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { isCommissioner: true },
  });

  console.log(`Granted commissioner access to: ${updated.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
