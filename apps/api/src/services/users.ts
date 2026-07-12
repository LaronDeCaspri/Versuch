import { ROLE, type Role } from "@cmp/core";
import type { PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { hashPassword } from "../auth/password.js";

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
  siteIds: string[];
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  active?: boolean;
  siteIds?: string[];
}

interface UserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  siteIds: string[];
}

function view(u: { id: string; email: string; name: string; role: Role; active: boolean; siteAccess: { siteId: string }[] }): UserView {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, siteIds: u.siteAccess.map((s) => s.siteId) };
}

async function assertSitesInOrg(prisma: PrismaClient, organizationId: string, siteIds: string[]): Promise<void> {
  if (siteIds.length === 0) return;
  const count = await prisma.site.count({ where: { organizationId, id: { in: siteIds } } });
  if (count !== new Set(siteIds).size) throw badRequest("One or more siteIds are not in this organization");
}

export async function listUsers(prisma: PrismaClient, auth: AuthContext): Promise<UserView[]> {
  const users = await prisma.user.findMany({
    where: { organizationId: auth.organizationId },
    include: { siteAccess: true },
    orderBy: { name: "asc" },
  });
  return users.map(view);
}

export async function createUser(prisma: PrismaClient, auth: AuthContext, input: CreateUserInput): Promise<UserView> {
  if (input.password.length < 8) throw badRequest("Password must be at least 8 characters");
  if (!(ROLE as readonly string[]).includes(input.role)) throw badRequest("Invalid role");
  await assertSitesInOrg(prisma, auth.organizationId, input.siteIds);

  const email = input.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { organizationId: auth.organizationId, email } });
  if (existing !== null) throw conflict("A user with this email already exists");

  const user = await prisma.user.create({
    data: {
      organizationId: auth.organizationId,
      email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      siteAccess: { create: input.siteIds.map((siteId) => ({ siteId })) },
    },
    include: { siteAccess: true },
  });
  return view(user);
}

/** Guards against removing the organization's last active OWNER. */
async function assertNotLastOwner(prisma: PrismaClient, organizationId: string, userId: string): Promise<void> {
  const owners = await prisma.user.count({ where: { organizationId, role: "OWNER", active: true, id: { not: userId } } });
  if (owners === 0) throw badRequest("Cannot remove the organization's last active owner");
}

export async function updateUser(
  prisma: PrismaClient,
  auth: AuthContext,
  userId: string,
  input: UpdateUserInput,
): Promise<UserView> {
  const target = await prisma.user.findFirst({
    where: { id: userId, organizationId: auth.organizationId },
    include: { siteAccess: true },
  });
  if (target === null) throw notFound("User not found");

  const losingOwner =
    target.role === "OWNER" && ((input.role !== undefined && input.role !== "OWNER") || input.active === false);
  if (losingOwner) {
    if (userId === auth.userId) throw forbidden("You cannot remove your own owner access");
    await assertNotLastOwner(prisma, auth.organizationId, userId);
  }
  if (input.role !== undefined && !(ROLE as readonly string[]).includes(input.role)) throw badRequest("Invalid role");
  if (input.siteIds !== undefined) await assertSitesInOrg(prisma, auth.organizationId, input.siteIds);

  const user = await prisma.$transaction(async (tx) => {
    if (input.siteIds !== undefined) {
      await tx.userSite.deleteMany({ where: { userId } });
      if (input.siteIds.length > 0) {
        await tx.userSite.createMany({ data: input.siteIds.map((siteId) => ({ userId, siteId })) });
      }
    }
    return tx.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: { siteAccess: true },
    });
  });
  return view(user);
}
