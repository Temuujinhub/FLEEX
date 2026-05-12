import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

// TimescaleDB-specific DDL that Prisma can't express (hypertables, retention,
// compression, continuous aggregates). The SQL is idempotent so it's safe to
// run on every API boot — Prisma `db push` creates the relational schema
// just before this runs.
@Injectable()
export class TimescaleInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TimescaleInitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    // Resolve relative to the running file: in production the file ships at
    // /app/prisma/timescale-init.sql while dist/main.js lives at /app/dist.
    const candidates = [
      join(__dirname, '..', '..', 'prisma', 'timescale-init.sql'),
      join(process.cwd(), 'prisma', 'timescale-init.sql'),
      '/app/prisma/timescale-init.sql',
    ];
    let sql: string | null = null;
    for (const p of candidates) {
      try {
        sql = await readFile(p, 'utf8');
        this.logger.log(`Loaded TimescaleDB init script from ${p}`);
        break;
      } catch {}
    }
    if (!sql) {
      this.logger.warn('timescale-init.sql not found; skipping hypertable setup');
      return;
    }

    // Run as a single multi-statement script. `$queryRawUnsafe` would fight
    // multi-statement; use `$executeRawUnsafe` per statement instead. We
    // split on `;` outside of `DO $$ ... $$;` blocks.
    const statements = splitSql(sql);
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      try {
        await this.prisma.$executeRawUnsafe(stmt);
      } catch (e) {
        // Some statements (e.g. add_compression_policy when already present
        // and if_not_exists is honoured) are harmless re-runs. Log at debug.
        const msg = (e as Error).message;
        if (/already exists|already enabled/i.test(msg)) {
          this.logger.debug(`Skipping idempotent stmt: ${msg}`);
        } else {
          this.logger.error(`TimescaleDB init failed on: ${stmt.slice(0, 120)}…\n${msg}`);
        }
      }
    }
    this.logger.log('TimescaleDB init complete');
  }
}

// SQL splitter that respects `DO $$ ... $$;` dollar-quoted blocks.
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const pair = sql.slice(i, i + 2);
    if (pair === '$$') {
      inDollar = !inDollar;
      buf += pair;
      i += 1;
      continue;
    }
    if (c === ';' && !inDollar) {
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) out.push(buf);
  // Strip comments-only statements.
  return out
    .map((s) => stripComments(s).trim())
    .filter((s) => s.length > 0);
}

function stripComments(s: string): string {
  return s
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}
