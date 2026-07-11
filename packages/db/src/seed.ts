import { scryptSync, randomBytes } from "node:crypto";
import { PrismaClient, type Authority, type Criticality } from "../node_modules/.prisma/client/index.js";
import { assetDutyDataFromDuty } from "./duties.js";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * System-provided duty templates (organizationId = null). Titles, authorities,
 * references and intervals are drafts for the domain expert to correct.
 */
interface DutyTemplate {
  assetType: string;
  titleEn: string;
  titleAr: string;
  authority: Authority;
  reference: string;
  intervalDays: number;
  graceDays: number;
  requiresCertificate: boolean;
  requiresThirdParty: boolean;
  isStatutory: boolean;
}

const DUTY_TEMPLATES: DutyTemplate[] = [
  {
    assetType: "fire_pump",
    titleEn: "Weekly running test",
    titleAr: "اختبار التشغيل الأسبوعي",
    authority: "CIVIL_DEFENSE",
    reference: "SBC 801 / NFPA 25",
    intervalDays: 7,
    graceDays: 3,
    requiresCertificate: false,
    requiresThirdParty: false,
    isStatutory: true,
  },
  {
    assetType: "fire_pump",
    titleEn: "Annual performance & flow test",
    titleAr: "اختبار الأداء والتدفق السنوي",
    authority: "CIVIL_DEFENSE",
    reference: "SBC 801 / NFPA 25",
    intervalDays: 365,
    graceDays: 30,
    requiresCertificate: true,
    requiresThirdParty: true,
    isStatutory: true,
  },
  {
    assetType: "fire_alarm_panel",
    titleEn: "Quarterly functional test",
    titleAr: "الاختبار الوظيفي الفصلي",
    authority: "CIVIL_DEFENSE",
    reference: "SBC 801",
    intervalDays: 90,
    graceDays: 14,
    requiresCertificate: false,
    requiresThirdParty: false,
    isStatutory: true,
  },
  {
    assetType: "fire_alarm_panel",
    titleEn: "Annual certification",
    titleAr: "الشهادة السنوية",
    authority: "CIVIL_DEFENSE",
    reference: "SBC 801",
    intervalDays: 365,
    graceDays: 30,
    requiresCertificate: true,
    requiresThirdParty: true,
    isStatutory: true,
  },
  {
    assetType: "diesel_generator",
    titleEn: "Monthly on-load test",
    titleAr: "اختبار الحمل الشهري",
    authority: "INTERNAL",
    reference: "O&M schedule",
    intervalDays: 30,
    graceDays: 7,
    requiresCertificate: false,
    requiresThirdParty: false,
    isStatutory: false,
  },
  {
    assetType: "diesel_generator",
    titleEn: "Annual major service",
    titleAr: "الصيانة السنوية الرئيسية",
    authority: "MANUFACTURER",
    reference: "OEM manual",
    intervalDays: 365,
    graceDays: 30,
    requiresCertificate: true,
    requiresThirdParty: false,
    isStatutory: false,
  },
  {
    assetType: "elevator",
    titleEn: "Statutory annual inspection",
    titleAr: "الفحص السنوي النظامي",
    authority: "MUNICIPALITY",
    reference: "Municipality lift regulation",
    intervalDays: 365,
    graceDays: 30,
    requiresCertificate: true,
    requiresThirdParty: true,
    isStatutory: true,
  },
  {
    assetType: "elevator",
    titleEn: "Semi-annual maintenance",
    titleAr: "الصيانة نصف السنوية",
    authority: "CLIENT_CONTRACT",
    reference: "Service contract",
    intervalDays: 180,
    graceDays: 14,
    requiresCertificate: false,
    requiresThirdParty: false,
    isStatutory: false,
  },
];

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return new Date(d.toISOString().slice(0, 10));
}

async function main(): Promise<void> {
  // TRUNCATE (not DELETE) so the reset bypasses the record-immutability trigger.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       access_logs, defects, inspection_records, asset_duties, assets,
       user_sites, users, sites, file_objects, inspection_duties, organizations
     RESTART IDENTITY CASCADE`,
  );

  await prisma.inspectionDuty.createMany({
    data: DUTY_TEMPLATES.map((t) => ({ ...t, organizationId: null })),
  });
  const templates = await prisma.inspectionDuty.findMany({ where: { organizationId: null } });

  const org = await prisma.organization.create({
    data: { name: "شركة الفيصل لإدارة المرافق" },
  });

  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "owner@demo.sa",
      name: "المالك",
      passwordHash: hashPassword("owner-password"),
      role: "OWNER",
    },
  });

  const site = await prisma.site.create({
    data: {
      organizationId: org.id,
      name: "مجمع الملك فهد الطبي",
      address: "الرياض، حي المروج",
      client: "وزارة الصحة",
      responsiblePerson: "م. أحمد الحربي",
    },
  });

  await prisma.userSite.create({ data: { userId: owner.id, siteId: site.id } });

  interface AssetSpec {
    tag: string;
    name: string;
    assetType: string;
    criticality: Criticality;
    commissionedOn: Date;
    location: string;
  }

  const assetSpecs: AssetSpec[] = [
    { tag: "FP-01", name: "مضخة الحريق الرئيسية", assetType: "fire_pump", criticality: "LIFE_SAFETY", commissionedOn: new Date("2019-03-01"), location: "قبو 2 - غرفة المضخات أ" },
    { tag: "FP-02", name: "مضخة الحريق الاحتياطية", assetType: "fire_pump", criticality: "LIFE_SAFETY", commissionedOn: new Date("2020-06-15"), location: "قبو 2 - غرفة المضخات ب" },
    { tag: "FA-01", name: "لوحة إنذار الحريق", assetType: "fire_alarm_panel", criticality: "LIFE_SAFETY", commissionedOn: new Date("2020-01-10"), location: "الدور الأرضي - غرفة الأمن" },
    { tag: "GEN-01", name: "مولد الديزل", assetType: "diesel_generator", criticality: "OPERATIONAL", commissionedOn: new Date("2018-09-01"), location: "الخارج - غرفة المولدات" },
    { tag: "ELV-01", name: "مصعد الركاب 1", assetType: "elevator", criticality: "OPERATIONAL", commissionedOn: new Date("2019-11-20"), location: "البهو الرئيسي" },
  ];

  const assetsByTag = new Map<string, string>();
  for (const spec of assetSpecs) {
    const asset = await prisma.asset.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        tag: spec.tag,
        name: spec.name,
        assetType: spec.assetType,
        criticality: spec.criticality,
        commissionedOn: spec.commissionedOn,
        locationDetail: spec.location,
      },
    });
    assetsByTag.set(spec.tag, asset.id);

    const matching = templates.filter((t) => t.assetType === spec.assetType);
    await prisma.assetDuty.createMany({
      data: matching.map((t) => assetDutyDataFromDuty(t, org.id, asset.id)),
    });
  }

  const assetId = (tag: string): string => {
    const id = assetsByTag.get(tag);
    if (id === undefined) throw new Error(`Unknown asset tag: ${tag}`);
    return id;
  };

  // FP-02 annual test performed recently → OK; weekly overdue stays visible.
  const fp02Annual = await prisma.assetDuty.findFirst({
    where: { assetId: assetId("FP-02"), intervalDays: 365 },
  });
  if (fp02Annual) {
    await prisma.inspectionRecord.create({
      data: {
        organizationId: org.id,
        assetDutyId: fp02Annual.id,
        performedOn: daysAgo(40),
        performedBy: "م. خالد",
        performedByCompany: "شركة السلامة المعتمدة",
        thirdPartyAccreditationRef: "SASO-2024-0912",
        result: "PASS",
        recordedById: owner.id,
      },
    });
  }

  // GEN-01 monthly test with defects → OPEN defect.
  const genMonthly = await prisma.assetDuty.findFirst({
    where: { assetId: assetId("GEN-01"), intervalDays: 30 },
  });
  if (genMonthly) {
    const failing = await prisma.inspectionRecord.create({
      data: {
        organizationId: org.id,
        assetDutyId: genMonthly.id,
        performedOn: daysAgo(10),
        performedBy: "م. سعد",
        result: "PASS_WITH_DEFECTS",
        findings: "تسرب طفيف في نظام التبريد",
        nextAction: "استبدال الخرطوم",
        recordedById: owner.id,
      },
    });
    await prisma.defect.create({
      data: {
        organizationId: org.id,
        assetDutyId: genMonthly.id,
        raisedByRecordId: failing.id,
        severity: "MAJOR",
        description: "تسرب طفيف في نظام التبريد",
        dueDate: daysAgo(-20),
        status: "OPEN",
      },
    });
  }

  const counts = {
    templates: templates.length,
    assets: assetSpecs.length,
    assetDuties: await prisma.assetDuty.count(),
  };
  // eslint-disable-next-line no-console
  console.log("Seed complete", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
