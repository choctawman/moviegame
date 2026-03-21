import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "@/server/auth/password";

interface LoginManifest {
  sharedPassword: string;
  accounts: Array<{
    email: string;
  }>;
}

const prisma = new PrismaClient();

async function main() {
  const manifestPath = path.join(process.cwd(), "shared-data", "login-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as LoginManifest;
  const passwordHash = await hashPassword(manifest.sharedPassword);

  for (const account of manifest.accounts) {
    await prisma.user.update({
      where: { email: account.email },
      data: { passwordHash },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
