import { PrismaClient } from "../node_modules/.prisma/client/index.js";

export const prisma = new PrismaClient();

export async function resetDb(): Promise<void> {
  // TRUNCATE on inspection_records is blocked by an immutability trigger; a
  // superuser test connection bypasses it for fixture reset via replica role.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET session_replication_role = 'replica'`),
    prisma.$executeRawUnsafe(
      `TRUNCATE TABLE
         access_logs, defects, inspection_records, asset_duties, assets,
         user_sites, users, sites, file_objects, inspection_duties, organizations, sessions
       RESTART IDENTITY CASCADE`,
    ),
    prisma.$executeRawUnsafe(`SET session_replication_role = 'origin'`),
  ]);
}

export async function seedOrgUser(): Promise<{ orgId: string; userId: string; siteId: string }> {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "t@test.sa",
      name: "Tester",
      passwordHash: "x",
      role: "OWNER",
    },
  });
  const site = await prisma.site.create({
    data: {
      organizationId: org.id,
      name: "Site",
      address: "Addr",
      client: "Client",
      responsiblePerson: "Person",
    },
  });
  return { orgId: org.id, userId: user.id, siteId: site.id };
}
