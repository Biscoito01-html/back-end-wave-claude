import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';

const prisma = new PrismaClient();

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n=== Seed: criação do primeiro usuário ===\n');

  const email = await ask(rl, 'Email: ');
  const password = await ask(rl, 'Senha (mín. 8 caracteres): ');
  const name = await ask(rl, 'Nome (opcional, Enter para pular): ');

  rl.close();

  if (!email || !password) {
    console.error('\nEmail e senha são obrigatórios.');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('\nA senha deve ter pelo menos 8 caracteres.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.warn(`\nUsuário com email "${email}" já existe. Nenhuma alteração feita.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // First user in the database is always created as admin
  const userCount = await prisma.user.count();
  const role = userCount === 0 ? 'admin' : 'user';

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: name.trim() || null,
      role,
    },
  });

  console.log(`\nUsuário criado com sucesso!`);
  console.log(`  ID:    ${user.id}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Role:  ${user.role}${user.role === 'admin' ? ' (administrador)' : ''}`);
  if (user.name) console.log(`  Nome:  ${user.name}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
