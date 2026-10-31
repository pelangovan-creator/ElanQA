import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Seeds the first Admin plus one demo user per role and a demo project (idempotent). */
async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@qapilot.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';
  const demoPassword = await bcrypt.hash('Demo!2345', 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, name: 'QA Pilot Admin', role: 'Admin', passwordHash: await bcrypt.hash(adminPassword, 12) },
  });

  const demoUsers = [
    { email: 'lead@qapilot.local', name: 'Priya Lead', role: 'QALead' },
    { email: 'tester@qapilot.local', name: 'Tom Tester', role: 'Tester' },
    { email: 'dev@qapilot.local', name: 'Dana Developer', role: 'Developer' },
    { email: 'client@qapilot.local', name: 'Chris Client', role: 'Client' },
  ];
  const created = [];
  for (const u of demoUsers) {
    created.push(await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash: demoPassword } }));
  }

  const project = await prisma.project.upsert({
    where: { key: 'DEMO' },
    update: {},
    create: { key: 'DEMO', name: 'Demo Shop', client: 'Acme Retail (synthetic)', description: 'Sample project for exploring QA Pilot', createdById: admin.id },
  });
  for (const u of [admin, ...created]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: u.id } },
      update: {},
      create: { projectId: project.id, userId: u.id, role: u.role },
    });
  }
  console.log(`Seeded admin ${adminEmail}, ${created.length} demo users (password Demo!2345) and project DEMO`);
}

main().finally(() => prisma.$disconnect());
