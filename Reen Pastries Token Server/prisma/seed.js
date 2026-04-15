const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Reen Pastries database...');

  // Default categories for a bakery
  const categories = [
    { name: 'Cakes', description: 'Custom and classic cakes for all occasions', sortOrder: 1 },
    { name: 'Cupcakes', description: 'Individual cupcakes in assorted flavours', sortOrder: 2 },
    { name: 'Cookies', description: 'Freshly baked cookies', sortOrder: 3 },
    { name: 'Pastries', description: 'Croissants, danishes, and more', sortOrder: 4 },
    { name: 'Bread', description: 'Artisan loaves and rolls', sortOrder: 5 },
    { name: 'Custom Orders', description: 'Special occasion custom bakes', sortOrder: 6 },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }
  console.log(`✅ ${categories.length} categories seeded`);

  // Default dev config values
  const configs = [
    {
      key: 'DEV_REVENUE_SHARE_PERCENT',
      value: process.env.DEV_REVENUE_SHARE_PERCENT || '5',
      description: 'Developer revenue share percentage applied to every completed order',
    },
    {
      key: 'CANCEL_WINDOW_MINUTES',
      value: '30',
      description: 'Minutes customer has to cancel an order after placing it',
    },
    {
      key: 'DEPOSIT_PERCENT',
      value: '50',
      description: 'Percentage of order total required as deposit',
    },
    {
      key: 'DELIVERY_FEE_KES',
      value: '0',
      description: 'Default delivery fee in KES (0 = free / pickup only)',
    },
    {
      key: 'APP_NAME',
      value: 'Reen Pastries',
      description: 'Display name of the app',
    },
    {
      key: 'OWNER_PHONE',
      value: '',
      description: "Owner's MPesa phone number for reference",
    },
  ];

  for (const config of configs) {
    await prisma.devConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }
  console.log(`✅ ${configs.length} config entries seeded`);

  console.log('\n🎂 Reen Pastries database ready!\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
