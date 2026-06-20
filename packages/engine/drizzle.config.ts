import { defineConfig } from "drizzle-kit"
import { join } from "path"

export default defineConfig({
    dialect: "sqlite",
    schema: "./src/storage/schema.ts",
    out: "./migration",
    dbCredentials: {
        url: join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".local", "share", "monkeydcode", "opencode.db"),
    },
})
