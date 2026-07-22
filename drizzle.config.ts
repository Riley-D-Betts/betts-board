import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: `${process.env.BETTS_DATA_DIR || '.data'}/betts.db`,
  },
})
