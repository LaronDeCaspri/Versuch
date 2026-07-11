import type { FastifyInstance } from "fastify";
import { getPrisma } from "@cmp/db";
import { hashPassword } from "../src/auth/password.js";
import { buildServer } from "../src/server.js";

export const prisma = getPrisma();

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       sessions, access_logs, defects, inspection_records, asset_duties, assets,
       user_sites, users, sites, file_objects, inspection_duties, organizations
     RESTART IDENTITY CASCADE`,
  );
}

let server: FastifyInstance | null = null;
export async function app(): Promise<FastifyInstance> {
  if (server === null) server = await buildServer();
  return server;
}

export interface Fixture {
  orgId: string;
  ownerId: string;
  techId: string;
  siteAId: string;
  siteBId: string;
}

/** One org: an OWNER (all sites) and a TECHNICIAN assigned to site A only. */
export async function seedFixture(): Promise<Fixture> {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const pw = await hashPassword("secret12345");
  const owner = await prisma.user.create({
    data: { organizationId: org.id, email: "owner@org.sa", name: "Owner", passwordHash: pw, role: "OWNER" },
  });
  const tech = await prisma.user.create({
    data: { organizationId: org.id, email: "tech@org.sa", name: "Tech", passwordHash: pw, role: "TECHNICIAN" },
  });
  const siteA = await prisma.site.create({
    data: { organizationId: org.id, name: "Site A", address: "A", client: "C", responsiblePerson: "P" },
  });
  const siteB = await prisma.site.create({
    data: { organizationId: org.id, name: "Site B", address: "B", client: "C", responsiblePerson: "P" },
  });
  await prisma.userSite.create({ data: { userId: tech.id, siteId: siteA.id } });

  await prisma.inspectionDuty.create({
    data: {
      organizationId: null,
      assetType: "fire_pump",
      titleEn: "Annual test",
      titleAr: "اختبار سنوي",
      authority: "CIVIL_DEFENSE",
      reference: "SBC 801",
      intervalDays: 365,
      graceDays: 30,
      requiresCertificate: true,
      requiresThirdParty: true,
      isStatutory: true,
    },
  });
  return { orgId: org.id, ownerId: owner.id, techId: tech.id, siteAId: siteA.id, siteBId: siteB.id };
}

export async function login(email: string, password = "secret12345"): Promise<string> {
  const res = await (await app()).inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "cmp_session");
  if (cookie === undefined) throw new Error("No session cookie set");
  return `cmp_session=${cookie.value}`;
}
